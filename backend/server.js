const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 5002;

// ============================================================
// LiveKit Configuration (Replace with your credentials)
// ============================================================
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'APIRqqt6XSrLUU3';

const LIVEKIT_API_SECRET =
  process.env.LIVEKIT_API_SECRET || 'kR1cbkqfjxekQSHW486Nol4VxleeQ3UfUzufnveUw1bM' ;
const LIVEKIT_URL =
  process.env.LIVEKIT_URL || "wss://vc-iflnvq5g.livekit.cloud";
const LIVEKIT_HTTP_URL = LIVEKIT_URL.replace(/^wss:/, "https:").replace(
  /^ws:/,
  "http:",
);
const TRANSCRIPTION_INPUT_SAMPLE_RATE =
  Number(process.env.TRANSCRIPTION_INPUT_SAMPLE_RATE) ||
  Number(process.env.TRANSCRIPTION_SAMPLE_RATE) ||
  48000;
const TRANSCRIPTION_OUTPUT_SAMPLE_RATE =
  Number(process.env.TRANSCRIPTION_OUTPUT_SAMPLE_RATE) || 16000;
const TRANSCRIPTION_DEFAULT_BITS_PER_SAMPLE = 16;
const TRANSCRIPTION_DEFAULT_CHANNELS = 1;
const TRANSCRIPTION_MODEL_PATH =
  process.env.VOSK_MODEL_PATH ||
  path.join(__dirname, "models", "vosk-model");
const TRANSCRIPTION_SESSION_TTL_MS = 10 * 60 * 1000;
const TRANSCRIPTION_PYTHON_BIN =
  process.env.TRANSCRIPTION_PYTHON_BIN || "python";
const TRANSCRIPTION_WORKER_PATH = path.join(
  __dirname,
  "transcription_worker.py",
);

// ============================================================
// In-memory room tracking
// ============================================================
const rooms = new Map();
// rooms structure: Map<roomName, Map<participantId, { name, uuid, joinedAt }>>
const meetings = new Map();
const roomService = new RoomServiceClient(
  LIVEKIT_HTTP_URL,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
);
const transcriptionSessions = new Map();
const transcriptionPendingRequests = new Map();
let transcriptionWorker = null;
let transcriptionWorkerReadline = null;
let transcriptionWorkerRequestCounter = 0;

app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "LiveKit Video Call Server is running",
    port: PORT,
    activeRooms: rooms.size,
  });
});

const ensureRoomMap = roomName => {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Map());
  }
  return rooms.get(roomName);
};

const removeParticipantFromRoom = (roomName, participantId) => {
  const room = rooms.get(roomName);
  if (!room) {
    return null;
  }

  const participant = room.get(participantId);
  room.delete(participantId);

  if (room.size === 0) {
    rooms.delete(roomName);
  }

  return participant || null;
};

const createParticipantAccess = async (roomName, participantName) => {
  const participantId = uuidv4();

  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: participantId,
    name: participantName,
  });

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const jwt = await token.toJwt();
  const room = ensureRoomMap(roomName);

  room.set(participantId, {
    name: participantName,
    uuid: participantId,
    joinedAt: new Date().toISOString(),
  });

  return {
    token: jwt,
    livekitUrl: LIVEKIT_URL,
    participantId,
  };
};

const getMeeting = roomName => meetings.get(roomName);

const isMeetingHost = (meeting, participantId) =>
  !!meeting && meeting.hostParticipantId === participantId;

const destroyTranscriptionSessionsForRoom = roomName => {
  const prefix = `${roomName}:`;

  Array.from(transcriptionSessions.keys()).forEach(sessionKey => {
    if (sessionKey.startsWith(prefix)) {
      destroyTranscriptionSession(sessionKey);
    }
  });
};

const cleanupMeetingIfRoomEmpty = roomName => {
  const room = rooms.get(roomName);
  if (!room || room.size === 0) {
    meetings.delete(roomName);
    destroyTranscriptionSessionsForRoom(roomName);
  }
};

const isLiveKitRoomNotFoundError = error => {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("room does not exist") ||
    message.includes("participant does not exist")
  );
};

const removeLiveKitParticipant = async (roomName, participantId) => {
  try {
    await roomService.removeParticipant(roomName, participantId);
  } catch (error) {
    if (!isLiveKitRoomNotFoundError(error)) {
      console.warn(
        `[LiveKit] Failed to remove participant ${participantId} from ${roomName}:`,
        error?.message || error,
      );
    }
  }
};

const deleteLiveKitRoom = async roomName => {
  try {
    await roomService.deleteRoom(roomName);
  } catch (error) {
    if (!isLiveKitRoomNotFoundError(error)) {
      console.warn(
        `[LiveKit] Failed to delete room ${roomName}:`,
        error?.message || error,
      );
    }
  }
};

const getTranscriptionSessionKey = (roomName, participantId) =>
  `${roomName}:${participantId}`;

const clearTranscriptionSession = sessionKey => {
  const session = transcriptionSessions.get(sessionKey);
  if (!session) {
    return null;
  }

  transcriptionSessions.delete(sessionKey);
  return session;
};

const rejectPendingTranscriptionRequests = message => {
  transcriptionPendingRequests.forEach(({ reject, timeout }) => {
    clearTimeout(timeout);
    reject(new Error(message));
  });
  transcriptionPendingRequests.clear();
};

const cleanupTranscriptionWorker = message => {
  if (transcriptionWorkerReadline) {
    transcriptionWorkerReadline.removeAllListeners();
    transcriptionWorkerReadline.close();
    transcriptionWorkerReadline = null;
  }

  transcriptionWorker = null;
  rejectPendingTranscriptionRequests(
    message || "Python transcription worker is not running.",
  );
};

const ensureTranscriptionWorker = () => {
  if (transcriptionWorker && !transcriptionWorker.killed) {
    return transcriptionWorker;
  }

  if (!fs.existsSync(TRANSCRIPTION_WORKER_PATH)) {
    throw new Error(
      `Python transcription worker was not found at ${TRANSCRIPTION_WORKER_PATH}`,
    );
  }

  transcriptionWorker = spawn(
    TRANSCRIPTION_PYTHON_BIN,
    ["-u", TRANSCRIPTION_WORKER_PATH],
    {
      cwd: __dirname,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  transcriptionWorker.stdout.setEncoding("utf8");
  transcriptionWorker.stderr.setEncoding("utf8");

  transcriptionWorkerReadline = readline.createInterface({
    input: transcriptionWorker.stdout,
  });

  transcriptionWorkerReadline.on("line", line => {
    if (!line.trim()) {
      return;
    }

    try {
      const message = JSON.parse(line);
      const pending = transcriptionPendingRequests.get(message.id);

      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      transcriptionPendingRequests.delete(message.id);

      if (message.success === false) {
        pending.reject(new Error(message.error || "Transcription worker error"));
        return;
      }

      pending.resolve(message);
    } catch (error) {
      console.warn(
        "[Transcription] Failed to parse worker response:",
        line,
        error?.message || error,
      );
    }
  });

  transcriptionWorker.stderr.on("data", chunk => {
    const message = chunk.toString().trim();
    if (message) {
      console.warn("[TranscriptionWorker]", message);
    }
  });

  transcriptionWorker.on("error", error => {
    cleanupTranscriptionWorker(
      error?.message || "Python transcription worker failed to start.",
    );
  });

  transcriptionWorker.on("exit", code => {
    cleanupTranscriptionWorker(
      `Python transcription worker exited with code ${code ?? "unknown"}.`,
    );
  });

  return transcriptionWorker;
};

const sendTranscriptionWorkerRequest = (action, payload = {}) =>
  new Promise((resolve, reject) => {
    let worker;

    try {
      worker = ensureTranscriptionWorker();
    } catch (error) {
      reject(error);
      return;
    }

    if (!worker.stdin || worker.stdin.destroyed || !worker.stdin.writable) {
      reject(new Error("Python transcription worker is not writable."));
      return;
    }

    const id = `tx-${Date.now()}-${transcriptionWorkerRequestCounter += 1}`;
    const timeout = setTimeout(() => {
      transcriptionPendingRequests.delete(id);
      reject(new Error("Python transcription worker request timed out."));
    }, 30000);

    transcriptionPendingRequests.set(id, {
      resolve,
      reject,
      timeout,
    });

    worker.stdin.write(
      `${JSON.stringify({
        id,
        action,
        ...payload,
      })}\n`,
      error => {
        if (!error) {
          return;
        }

        clearTimeout(timeout);
        transcriptionPendingRequests.delete(id);
        reject(error);
      },
    );
  });

const getTranscriptionAvailability = async () => {
  if (!fs.existsSync(TRANSCRIPTION_MODEL_PATH)) {
    return {
      available: false,
      reason: `Offline transcription model was not found at ${TRANSCRIPTION_MODEL_PATH}`,
    };
  }

  try {
    const response = await sendTranscriptionWorkerRequest("status", {
      modelPath: TRANSCRIPTION_MODEL_PATH,
      outputSampleRate: TRANSCRIPTION_OUTPUT_SAMPLE_RATE,
    });

    return {
      available: !!response.available,
      reason: response.reason || null,
    };
  } catch (error) {
    return {
      available: false,
      reason:
        error instanceof Error
          ? error.message
          : "Python transcription worker is unavailable.",
    };
  }
};

const destroyTranscriptionSession = sessionKey => {
  const session = clearTranscriptionSession(sessionKey);
  if (!session) {
    return null;
  }

  sendTranscriptionWorkerRequest("stop", { sessionId: sessionKey }).catch(error => {
    console.warn(
      "[Transcription] Failed to stop Python transcription session:",
      error?.message || error,
    );
  });

  return session;
};

const ensureTranscriptionSession = async (roomName, participantId) => {
  const sessionKey = getTranscriptionSessionKey(roomName, participantId);

  clearTranscriptionSession(sessionKey);
  await sendTranscriptionWorkerRequest("start", {
    sessionId: sessionKey,
    modelPath: TRANSCRIPTION_MODEL_PATH,
    outputSampleRate: TRANSCRIPTION_OUTPUT_SAMPLE_RATE,
  });

  transcriptionSessions.set(sessionKey, {
    roomName,
    participantId,
    updatedAt: Date.now(),
  });

  return sessionKey;
};

const clampInt16 = value => {
  if (value > 32767) {
    return 32767;
  }
  if (value < -32768) {
    return -32768;
  }
  return Math.round(value);
};

const decodePcmBuffer = (audioBuffer, bitsPerSample) => {
  if (bitsPerSample === 16) {
    const sampleCount = Math.floor(audioBuffer.length / 2);
    const samples = new Int16Array(sampleCount);

    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = audioBuffer.readInt16LE(index * 2);
    }

    return samples;
  }

  if (bitsPerSample === 32) {
    const sampleCount = Math.floor(audioBuffer.length / 4);
    const samples = new Int16Array(sampleCount);

    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = clampInt16(audioBuffer.readFloatLE(index * 4) * 32767);
    }

    return samples;
  }

  throw new Error(
    `Unsupported transcription audio format: ${bitsPerSample}-bit PCM`,
  );
};

const downmixToMono = (samples, numberOfChannels) => {
  if (!numberOfChannels || numberOfChannels <= 1) {
    return samples;
  }

  const frameCount = Math.floor(samples.length / numberOfChannels);
  const monoSamples = new Int16Array(frameCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let sum = 0;

    for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex += 1) {
      sum += samples[frameIndex * numberOfChannels + channelIndex];
    }

    monoSamples[frameIndex] = clampInt16(sum / numberOfChannels);
  }

  return monoSamples;
};

const resamplePcm16 = (samples, inputSampleRate, outputSampleRate) => {
  if (inputSampleRate === outputSampleRate) {
    return samples;
  }

  const outputLength = Math.max(
    1,
    Math.round(samples.length * (outputSampleRate / inputSampleRate)),
  );
  const outputSamples = new Int16Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const position = outputIndex * (inputSampleRate / outputSampleRate);
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const interpolation = position - leftIndex;
    const leftSample = samples[leftIndex] || 0;
    const rightSample = samples[rightIndex] || leftSample;

    outputSamples[outputIndex] = clampInt16(
      leftSample + (rightSample - leftSample) * interpolation,
    );
  }

  return outputSamples;
};

const pcm16ToBuffer = samples => {
  const output = Buffer.allocUnsafe(samples.length * 2);

  for (let index = 0; index < samples.length; index += 1) {
    output.writeInt16LE(samples[index], index * 2);
  }

  return output;
};

const normalizeTranscriptionAudioChunk = ({
  audioBuffer,
  bitsPerSample,
  sampleRate,
  numberOfChannels,
}) => {
  const resolvedBitsPerSample =
    Number(bitsPerSample) || TRANSCRIPTION_DEFAULT_BITS_PER_SAMPLE;
  const resolvedSampleRate =
    Number(sampleRate) || TRANSCRIPTION_INPUT_SAMPLE_RATE;
  const resolvedChannelCount =
    Number(numberOfChannels) || TRANSCRIPTION_DEFAULT_CHANNELS;

  const decodedSamples = decodePcmBuffer(audioBuffer, resolvedBitsPerSample);
  const monoSamples = downmixToMono(decodedSamples, resolvedChannelCount);
  const resampledSamples = resamplePcm16(
    monoSamples,
    resolvedSampleRate,
    TRANSCRIPTION_OUTPUT_SAMPLE_RATE,
  );

  return pcm16ToBuffer(resampledSamples);
};

setInterval(() => {
  const cutoff = Date.now() - TRANSCRIPTION_SESSION_TTL_MS;

  transcriptionSessions.forEach((session, sessionKey) => {
    if (session.updatedAt < cutoff) {
      destroyTranscriptionSession(sessionKey);
    }
  });
}, 60 * 1000);

// ============================================================
// POST /create-token
// ============================================================
app.post("/create-token", async (req, res) => {
  try {
    const { roomName, participantName } = req.body;

    // Validation
    if (!roomName || !participantName) {
      return res.status(400).json({
        error: "Missing required fields: roomName and participantName",
      });
    }

    const access = await createParticipantAccess(roomName, participantName);
    const room = rooms.get(roomName);

    const totalParticipants = room.size;
    const timestamp = new Date().toISOString();

    // Console logging with formatted output
    console.log("\n========================");
    console.log("   NEW PARTICIPANT JOINED");
    console.log("========================");
    console.log(`  Room:               ${roomName}`);
    console.log(`  User:               ${participantName}`);
    console.log(`  UUID:               ${access.participantId}`);
    console.log(`  Token:              ${access.token.substring(0, 40)}...`);
    console.log(`  Timestamp:          ${timestamp}`);
    console.log(`  Total Participants: ${totalParticipants}`);
    console.log("========================\n");

    return res.json(access);
  } catch (error) {
    console.error("Error creating token:", error);
    return res.status(500).json({
      error: "Failed to create token",
      details: error.message,
    });
  }
});

// ============================================================
// POST /leave-room — optional cleanup endpoint
// ============================================================
app.post("/leave-room", async (req, res) => {
  try {
    const { roomName, participantId } = req.body;

    if (!roomName || !participantId) {
      return res.status(400).json({
        error: "Missing required fields: roomName and participantId",
      });
    }

    const participant = removeParticipantFromRoom(roomName, participantId);
    destroyTranscriptionSession(getTranscriptionSessionKey(roomName, participantId));
    const room = rooms.get(roomName);

    cleanupMeetingIfRoomEmpty(roomName);

    if (!room) {
      await deleteLiveKitRoom(roomName);
    }

    if (participant) {
      console.log("\n========================");
      console.log("   PARTICIPANT LEFT");
      console.log("========================");
      console.log(`  Room:               ${roomName}`);
      console.log(`  User:               ${participant?.name || "Unknown"}`);
      console.log(`  UUID:               ${participantId}`);
      console.log(`  Remaining:          ${room?.size || 0}`);
      console.log(`  Timestamp:          ${new Date().toISOString()}`);
      console.log("========================\n");
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Error leaving room:", error);
    return res.status(500).json({
      error: "Failed to leave room",
      details: error.message,
    });
  }
});

// ============================================================
// POST /meetings/create
// Host creates a meeting and joins immediately
// ============================================================
app.post("/meetings/create", async (req, res) => {
  try {
    const { roomName, participantName } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({
        error: "Missing required fields: roomName and participantName",
      });
    }

    const existingMeeting = getMeeting(roomName);
    const existingRoom = rooms.get(roomName);
    if (existingMeeting && !existingMeeting.ended) {
      if (!existingRoom || existingRoom.size === 0) {
        meetings.delete(roomName);
        await deleteLiveKitRoom(roomName);
      } else {
      return res.status(409).json({
        error: "A meeting for this room already exists",
      });
      }
    }

    const access = await createParticipantAccess(roomName, participantName);

    meetings.set(roomName, {
      hostParticipantId: access.participantId,
      hostName: participantName,
      createdAt: new Date().toISOString(),
      ended: false,
      waitingRequests: new Map(),
      participantStatuses: new Map([[access.participantId, "active"]]),
    });

    console.log("\n========================");
    console.log("   MEETING CREATED");
    console.log("========================");
    console.log(`  Room:               ${roomName}`);
    console.log(`  Host:               ${participantName}`);
    console.log(`  Host UUID:          ${access.participantId}`);
    console.log(`  Timestamp:          ${new Date().toISOString()}`);
    console.log("========================\n");

    return res.json(access);
  } catch (error) {
    console.error("Error creating meeting:", error);
    return res.status(500).json({
      error: "Failed to create meeting",
      details: error.message,
    });
  }
});

// ============================================================
// POST /meetings/request-access
// Guest joins waiting room until admitted by host
// ============================================================
app.post("/meetings/request-access", (req, res) => {
  try {
    const { roomName, participantName } = req.body;

    if (!roomName || !participantName) {
      return res.status(400).json({
        error: "Missing required fields: roomName and participantName",
      });
    }

    const meeting = getMeeting(roomName);
    if (!meeting || meeting.ended) {
      return res.status(404).json({
        error: "Meeting not found. Ask the host to create it first.",
      });
    }

    const requestId = uuidv4();
    meeting.waitingRequests.set(requestId, {
      requestId,
      participantName,
      createdAt: new Date().toISOString(),
      status: "waiting",
    });

    return res.json({
      requestId,
      status: "waiting",
    });
  } catch (error) {
    console.error("Error requesting meeting access:", error);
    return res.status(500).json({
      error: "Failed to request meeting access",
      details: error.message,
    });
  }
});

// ============================================================
// GET /meetings/request-status
// Guest polls waiting-room status until admitted or removed
// ============================================================
app.get("/meetings/request-status", (req, res) => {
  try {
    const { roomName, requestId } = req.query;
    const meeting = getMeeting(roomName);

    if (!meeting) {
      return res.status(404).json({
        status: "ended",
        message: "Meeting is no longer available.",
      });
    }

    const request = meeting.waitingRequests.get(requestId);
    if (!request) {
      return res.status(404).json({
        status: "removed",
        message: "Meeting request not found.",
      });
    }

    if (meeting.ended && request.status !== "admitted") {
      return res.json({
        status: "ended",
        message: "Meeting ended before you were admitted.",
      });
    }

    if (request.status === "admitted") {
      return res.json({
        status: "admitted",
        token: request.token,
        livekitUrl: request.livekitUrl,
        participantId: request.participantId,
      });
    }

    if (request.status === "removed") {
      return res.json({
        status: "removed",
        message: request.message || "Host removed your request.",
      });
    }

    return res.json({
      status: "waiting",
    });
  } catch (error) {
    console.error("Error checking meeting request status:", error);
    return res.status(500).json({
      error: "Failed to check meeting request status",
      details: error.message,
    });
  }
});

// ============================================================
// GET /meetings/waiting-room
// Host polls current waiting-room users
// ============================================================
app.get("/meetings/waiting-room", (req, res) => {
  try {
    const { roomName, hostParticipantId } = req.query;
    const meeting = getMeeting(roomName);

    if (!meeting || meeting.ended) {
      return res.status(404).json({
        error: "Meeting not found",
      });
    }

    if (!isMeetingHost(meeting, hostParticipantId)) {
      return res.status(403).json({
        error: "Only the meeting host can view the waiting room",
      });
    }

    const waitingParticipants = Array.from(meeting.waitingRequests.values())
      .filter(request => request.status === "waiting")
      .map(request => ({
        requestId: request.requestId,
        participantName: request.participantName,
        createdAt: request.createdAt,
      }));

    return res.json({ waitingParticipants });
  } catch (error) {
    console.error("Error loading waiting room:", error);
    return res.status(500).json({
      error: "Failed to load waiting room",
      details: error.message,
    });
  }
});

// ============================================================
// POST /meetings/admit
// Host admits a waiting participant into the meeting
// ============================================================
app.post("/meetings/admit", async (req, res) => {
  try {
    const { roomName, hostParticipantId, requestId } = req.body;
    const meeting = getMeeting(roomName);

    if (!meeting || meeting.ended) {
      return res.status(404).json({
        error: "Meeting not found",
      });
    }

    if (!isMeetingHost(meeting, hostParticipantId)) {
      return res.status(403).json({
        error: "Only the meeting host can admit participants",
      });
    }

    const request = meeting.waitingRequests.get(requestId);
    if (!request || request.status !== "waiting") {
      return res.status(404).json({
        error: "Waiting participant not found",
      });
    }

    const access = await createParticipantAccess(roomName, request.participantName);

    request.status = "admitted";
    request.participantId = access.participantId;
    request.token = access.token;
    request.livekitUrl = access.livekitUrl;
    meeting.participantStatuses.set(access.participantId, "active");

    return res.json({
      success: true,
      participantId: access.participantId,
      participantName: request.participantName,
    });
  } catch (error) {
    console.error("Error admitting participant:", error);
    return res.status(500).json({
      error: "Failed to admit participant",
      details: error.message,
    });
  }
});

// ============================================================
// POST /meetings/remove-waiting
// Host removes a waiting request before admission
// ============================================================
app.post("/meetings/remove-waiting", (req, res) => {
  try {
    const { roomName, hostParticipantId, requestId } = req.body;
    const meeting = getMeeting(roomName);

    if (!meeting || meeting.ended) {
      return res.status(404).json({
        error: "Meeting not found",
      });
    }

    if (!isMeetingHost(meeting, hostParticipantId)) {
      return res.status(403).json({
        error: "Only the meeting host can remove waiting participants",
      });
    }

    const request = meeting.waitingRequests.get(requestId);
    if (!request || request.status !== "waiting") {
      return res.status(404).json({
        error: "Waiting participant not found",
      });
    }

    request.status = "removed";
    request.message = "Host declined your meeting request.";

    return res.json({ success: true });
  } catch (error) {
    console.error("Error removing waiting participant:", error);
    return res.status(500).json({
      error: "Failed to remove waiting participant",
      details: error.message,
    });
  }
});

// ============================================================
// POST /meetings/kick
// Host removes an active participant from the meeting
// ============================================================
app.post("/meetings/kick", async (req, res) => {
  try {
    const { roomName, hostParticipantId, participantId } = req.body;
    const meeting = getMeeting(roomName);

    if (!meeting || meeting.ended) {
      return res.status(404).json({
        error: "Meeting not found",
      });
    }

    if (!isMeetingHost(meeting, hostParticipantId)) {
      return res.status(403).json({
        error: "Only the meeting host can kick participants",
      });
    }

    if (participantId === hostParticipantId) {
      return res.status(400).json({
        error: "Host cannot kick themselves",
      });
    }

    meeting.participantStatuses.set(participantId, "kicked");
    removeParticipantFromRoom(roomName, participantId);
    destroyTranscriptionSession(getTranscriptionSessionKey(roomName, participantId));
    await removeLiveKitParticipant(roomName, participantId);
    cleanupMeetingIfRoomEmpty(roomName);

    return res.json({ success: true });
  } catch (error) {
    console.error("Error kicking participant:", error);
    return res.status(500).json({
      error: "Failed to kick participant",
      details: error.message,
    });
  }
});

// ============================================================
// GET /meetings/participant-status
// Active meeting participants poll for kick/end status
// ============================================================
app.get("/meetings/participant-status", (req, res) => {
  try {
    const { roomName, participantId } = req.query;
    const meeting = getMeeting(roomName);

    if (!meeting) {
      return res.json({
        status: "ended",
        message: "Meeting no longer exists.",
      });
    }

    if (participantId === meeting.hostParticipantId) {
      return res.json({
        status: meeting.ended ? "ended" : "active",
      });
    }

    const participantStatus = meeting.participantStatuses.get(participantId);
    if (participantStatus === "kicked") {
      return res.json({
        status: "kicked",
        message: "Host removed you from the meeting.",
      });
    }

    if (meeting.ended) {
      return res.json({
        status: "ended",
        message: "Host ended the meeting.",
      });
    }

    return res.json({
      status: "active",
    });
  } catch (error) {
    console.error("Error checking participant status:", error);
    return res.status(500).json({
      error: "Failed to check participant status",
      details: error.message,
    });
  }
});

// ============================================================
// POST /meetings/cancel-request
// Waiting participant leaves before being admitted
// ============================================================
app.post("/meetings/cancel-request", (req, res) => {
  try {
    const { roomName, requestId } = req.body;
    const meeting = getMeeting(roomName);

    if (!meeting) {
      return res.json({ success: true });
    }

    meeting.waitingRequests.delete(requestId);

    return res.json({ success: true });
  } catch (error) {
    console.error("Error cancelling meeting request:", error);
    return res.status(500).json({
      error: "Failed to cancel meeting request",
      details: error.message,
    });
  }
});

// ============================================================
// POST /meetings/leave
// Cleanup meeting-specific state when a participant leaves
// ============================================================
app.post("/meetings/leave", async (req, res) => {
  try {
    const { roomName, participantId } = req.body;
    const meeting = getMeeting(roomName);

    if (!meeting) {
      return res.json({ success: true });
    }

    if (participantId === meeting.hostParticipantId) {
      meetings.delete(roomName);
      destroyTranscriptionSessionsForRoom(roomName);
      await deleteLiveKitRoom(roomName);
    } else {
      meeting.participantStatuses.delete(participantId);
      destroyTranscriptionSession(getTranscriptionSessionKey(roomName, participantId));
      cleanupMeetingIfRoomEmpty(roomName);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Error leaving meeting:", error);
    return res.status(500).json({
      error: "Failed to leave meeting",
      details: error.message,
    });
  }
});

// ============================================================
// GET /room-participants — list active participant IDs for one room
// ============================================================
app.get("/room-participants", (req, res) => {
  const { roomName } = req.query;

  if (!roomName) {
    return res.status(400).json({
      error: "Missing required field: roomName",
    });
  }

  const room = rooms.get(roomName);

  return res.json({
    participantIds: room ? Array.from(room.keys()) : [],
  });
});

// ============================================================
// GET /transcription/status
// Report whether offline transcription is ready on the backend
// ============================================================
app.get("/transcription/status", async (req, res) => {
  const availability = await getTranscriptionAvailability();

  return res.json({
    available: availability.available,
    reason: availability.reason || null,
    inputSampleRate: TRANSCRIPTION_INPUT_SAMPLE_RATE,
    outputSampleRate: TRANSCRIPTION_OUTPUT_SAMPLE_RATE,
    modelPath: TRANSCRIPTION_MODEL_PATH,
    pythonBin: TRANSCRIPTION_PYTHON_BIN,
  });
});

// ============================================================
// POST /transcription/start
// Create or reset one participant transcription session
// ============================================================
app.post("/transcription/start", async (req, res) => {
  try {
    const { roomName, participantId } = req.body;

    if (!roomName || !participantId) {
      return res.status(400).json({
        error: "Missing required fields: roomName and participantId",
      });
    }

    const availability = await getTranscriptionAvailability();
    if (!availability.available) {
      return res.status(503).json({
        error: availability.reason,
      });
    }

    const sessionKey = await ensureTranscriptionSession(roomName, participantId);

    return res.json({
      success: true,
      sessionId: sessionKey,
      sampleRate: TRANSCRIPTION_OUTPUT_SAMPLE_RATE,
    });
  } catch (error) {
    console.error("Error starting transcription session:", error);
    return res.status(500).json({
      error: "Failed to start transcription session",
      details: error.message,
    });
  }
});

// ============================================================
// POST /transcription/chunk
// Accept a raw PCM chunk and return partial/final text
// ============================================================
app.post("/transcription/chunk", async (req, res) => {
  try {
    const {
      sessionId,
      audioBase64,
      bitsPerSample,
      sampleRate,
      numberOfChannels,
    } = req.body;

    if (!sessionId || !audioBase64) {
      return res.status(400).json({
        error: "Missing required fields: sessionId and audioBase64",
      });
    }

    const session = transcriptionSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({
        error: "Transcription session not found",
      });
    }

    const audioBuffer = Buffer.from(audioBase64, "base64");
    session.updatedAt = Date.now();

    if (audioBuffer.length === 0) {
      return res.json({
        text: "",
        isFinal: false,
      });
    }

    const normalizedAudioBuffer = normalizeTranscriptionAudioChunk({
      audioBuffer,
      bitsPerSample,
      sampleRate,
      numberOfChannels,
    });

    if (normalizedAudioBuffer.length === 0) {
      return res.json({
        text: "",
        isFinal: false,
      });
    }

    const workerResponse = await sendTranscriptionWorkerRequest("chunk", {
      sessionId,
      audioBase64: normalizedAudioBuffer.toString("base64"),
    });
    const text = String(workerResponse.text || "").trim();

    return res.json({
      text,
      isFinal: !!workerResponse.isFinal,
    });
  } catch (error) {
    console.error("Error processing transcription chunk:", error);
    return res.status(500).json({
      error: "Failed to process transcription chunk",
      details: error.message,
    });
  }
});

// ============================================================
// POST /transcription/stop
// Finalize and destroy one participant transcription session
// ============================================================
app.post("/transcription/stop", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        error: "Missing required field: sessionId",
      });
    }

    const session = clearTranscriptionSession(sessionId);
    if (!session) {
      return res.json({
        success: true,
        text: "",
      });
    }

    let text = "";
    try {
      const workerResponse = await sendTranscriptionWorkerRequest("stop", {
        sessionId,
      });
      text = String(workerResponse.text || "").trim();
    } catch (error) {
      console.warn(
        "[Transcription] Failed to finalize Python transcription session:",
        error?.message || error,
      );
    }

    return res.json({
      success: true,
      text,
    });
  } catch (error) {
    console.error("Error stopping transcription session:", error);
    return res.status(500).json({
      error: "Failed to stop transcription session",
      details: error.message,
    });
  }
});

// ============================================================
// GET /rooms — list active rooms (debug endpoint)
// ============================================================
app.get("/rooms", (req, res) => {
  const roomList = {};
  rooms.forEach((participants, roomName) => {
    roomList[roomName] = {
      participantCount: participants.size,
      participants: Array.from(participants.values()),
    };
  });
  return res.json({ rooms: roomList });
});

const shutdownTranscriptionWorker = () => {
  if (transcriptionWorker && !transcriptionWorker.killed) {
    transcriptionWorker.kill();
  }
  cleanupTranscriptionWorker("Python transcription worker was stopped.");
};

process.on("exit", shutdownTranscriptionWorker);
process.on("SIGINT", () => {
  shutdownTranscriptionWorker();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdownTranscriptionWorker();
  process.exit(0);
});

// ============================================================
// Start Server
// ============================================================
app.listen(PORT, () => {
  console.log("\n============================================================");
  console.log("   LiveKit Video Call Server");
  console.log("============================================================");
  console.log(`   Port:        ${PORT}`);
  console.log(`   LiveKit URL: ${LIVEKIT_URL}`);
  console.log(`   API Key:     ${LIVEKIT_API_KEY.substring(0, 8)}...`);
  console.log(`   Started:     ${new Date().toISOString()}`);
  console.log("============================================================");
  console.log(`   Server ready at http://localhost:${PORT}`);
  console.log("============================================================\n");
});
