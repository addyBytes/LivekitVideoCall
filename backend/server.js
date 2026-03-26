const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
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
const TRANSCRIPTION_SESSION_TTL_MS = 10 * 60 * 1000;
const TRANSCRIPTION_RESULT_WAIT_MS =
  Number(process.env.TRANSCRIPTION_RESULT_WAIT_MS) || 1200;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-3";
const DEEPGRAM_LANGUAGE = process.env.DEEPGRAM_LANGUAGE || "en-US";
const DEEPGRAM_ENDPOINTING =
  Number(process.env.DEEPGRAM_ENDPOINTING) || 250;
const DEEPGRAM_UTTERANCE_END_MS =
  Number(process.env.DEEPGRAM_UTTERANCE_END_MS) || 1000;
const DEEPGRAM_SMART_FORMAT = true;
const DEEPGRAM_PUNCTUATE = true;
const DEEPGRAM_INTERIM_RESULTS = true;
const DEEPGRAM_VAD_EVENTS = true;
const DEEPGRAM_CHANNELS = 1;

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
let deepgramClient = null;

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

const getDeepgramClient = () => {
  if (deepgramClient) {
    return deepgramClient;
  }

  if (!DEEPGRAM_API_KEY) {
    throw new Error("Missing DEEPGRAM_API_KEY.");
  }

  deepgramClient = createClient(DEEPGRAM_API_KEY);
  return deepgramClient;
};

const clearTranscriptWaiters = session => {
  if (!session?.pendingResolvers) {
    return;
  }

  session.pendingResolvers.forEach(({ timeout }) => clearTimeout(timeout));
  session.pendingResolvers = [];
};

const rejectTranscriptWaiters = (session, error) => {
  if (!session?.pendingResolvers) {
    return;
  }

  session.pendingResolvers.forEach(({ timeout, reject }) => {
    clearTimeout(timeout);
    reject(error);
  });
  session.pendingResolvers = [];
};

const resolveTranscriptWaiters = (session, payload) => {
  if (!session?.pendingResolvers || session.pendingResolvers.length === 0) {
    return;
  }

  const resolvers = session.pendingResolvers.splice(0);
  resolvers.forEach(({ timeout, resolve }) => {
    clearTimeout(timeout);
    resolve(payload);
  });
};

const getTranscriptionSession = sessionKey => transcriptionSessions.get(sessionKey);

const removeTranscriptionSession = sessionKey => {
  const session = transcriptionSessions.get(sessionKey);
  if (!session) {
    return null;
  }

  transcriptionSessions.delete(sessionKey);
  clearTranscriptWaiters(session);

  if (session.openReject) {
    session.openReject(new Error("Deepgram transcription session was closed."));
    session.openReject = null;
    session.openResolve = null;
  }

  if (session.connection) {
    try {
      session.closing = true;
      const finishResult = session.connection.finish?.();
      if (finishResult && typeof finishResult.then === "function") {
        void finishResult.catch(error => {
          console.warn(
            "[Transcription] Failed to finish Deepgram session:",
            error?.message || error,
          );
        });
      }
    } catch (error) {
      console.warn(
        "[Transcription] Failed to finish Deepgram session:",
        error?.message || error,
      );
    }
  }

  return session;
};

const destroyTranscriptionSession = removeTranscriptionSession;

const createDeepgramConnection = async sessionKey => {
  const deepgram = getDeepgramClient();
  const connection = deepgram.listen.live({
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
    smart_format: DEEPGRAM_SMART_FORMAT,
    punctuate: DEEPGRAM_PUNCTUATE,
    interim_results: DEEPGRAM_INTERIM_RESULTS,
    vad_events: DEEPGRAM_VAD_EVENTS,
    endpointing: DEEPGRAM_ENDPOINTING,
    utterance_end_ms: DEEPGRAM_UTTERANCE_END_MS,
    encoding: "linear16",
    sample_rate: TRANSCRIPTION_OUTPUT_SAMPLE_RATE,
    channels: DEEPGRAM_CHANNELS,
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    const session = transcriptionSessions.get(sessionKey);
    if (session) {
      session.isOpen = true;
      if (session.openResolve) {
        session.openResolve();
        session.openResolve = null;
        session.openReject = null;
      }
    }
  });

  connection.on(LiveTranscriptionEvents.Transcript, message => {
    if (!message) {
      return;
    }

    const session = transcriptionSessions.get(sessionKey);
    if (!session) {
      return;
    }

    const text = String(
      message.channel?.alternatives?.[0]?.transcript ||
        message.alternatives?.[0]?.transcript ||
        "",
    ).trim();
    const isFinal = !!message.is_final || !!message.speech_final;

    if (!text) {
      return;
    }

    const changed =
      text !== session.lastTranscript || isFinal !== session.lastIsFinal;
    session.lastTranscript = text;
    session.lastIsFinal = isFinal;
    session.updatedAt = Date.now();

    if (changed) {
      session.revision += 1;
      const payload = {
        text,
        isFinal,
        revision: session.revision,
      };
      resolveTranscriptWaiters(session, payload);
    }
  });

  connection.on(LiveTranscriptionEvents.Error, error => {
    const session = transcriptionSessions.get(sessionKey);
    if (!session) {
      return;
    }

    session.lastError = error?.message || String(error);
    if (session.openReject) {
      session.openReject(new Error(session.lastError));
      session.openReject = null;
      session.openResolve = null;
    }
    rejectTranscriptWaiters(
      session,
      new Error(session.lastError || "Deepgram transcription connection error."),
    );
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    const session = transcriptionSessions.get(sessionKey);
    if (!session) {
      return;
    }

    session.closed = true;
    if (!session.closing) {
      if (session.openReject) {
        session.openReject(
          new Error("Deepgram transcription connection closed unexpectedly."),
        );
        session.openReject = null;
        session.openResolve = null;
      }
      rejectTranscriptWaiters(
        session,
        new Error("Deepgram transcription connection closed unexpectedly."),
      );
      transcriptionSessions.delete(sessionKey);
    }
  });

  return connection;
};

const waitForDeepgramOpen = session =>
  new Promise((resolve, reject) => {
    if (session.isOpen) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      session.openReject = null;
      session.openResolve = null;
      reject(new Error("Deepgram transcription connection timed out while opening."));
    }, 15000);

    session.openResolve = () => {
      clearTimeout(timeout);
      resolve();
    };

    session.openReject = error => {
      clearTimeout(timeout);
      reject(error);
    };
  });

const waitForTranscriptUpdate = (session, revision) =>
  new Promise(resolve => {
    if (session.revision > revision) {
      resolve({
        text: session.lastTranscript,
        isFinal: session.lastIsFinal,
        revision: session.revision,
      });
      return;
    }

    const timeout = setTimeout(() => {
      session.pendingResolvers = session.pendingResolvers.filter(
        entry => entry.timeout !== timeout,
      );
      resolve(null);
    }, TRANSCRIPTION_RESULT_WAIT_MS);

    session.pendingResolvers.push({
      revision,
      resolve,
      timeout,
    });
  });

const createTranscriptResponse = session => {
  const text = String(session.lastTranscript || "").trim();
  const shouldDeliver =
    text &&
    (text !== session.lastDeliveredTranscript ||
      session.lastIsFinal !== session.lastDeliveredIsFinal);

  if (!shouldDeliver) {
    return null;
  }

  session.lastDeliveredTranscript = text;
  session.lastDeliveredIsFinal = session.lastIsFinal;

  return {
    text,
    isFinal: session.lastIsFinal,
  };
};

const getTranscriptionAvailability = () => {
  if (!DEEPGRAM_API_KEY) {
    return {
      available: false,
      reason:
        "Missing DEEPGRAM_API_KEY. Create one in Deepgram and set it in backend environment variables.",
    };
  }

  return { available: true };
};

const ensureTranscriptionSession = async (roomName, participantId) => {
  const sessionKey = getTranscriptionSessionKey(roomName, participantId);
  const existingSession = transcriptionSessions.get(sessionKey);

  if (existingSession?.connection) {
    try {
      existingSession.closing = true;
      existingSession.connection.finish?.();
    } catch {
      // Best effort.
    }
  }

  transcriptionSessions.delete(sessionKey);

  const session = {
    roomName,
    participantId,
    connection: null,
    updatedAt: Date.now(),
    revision: 0,
    lastTranscript: "",
    lastIsFinal: false,
    lastDeliveredTranscript: "",
    lastDeliveredIsFinal: false,
    lastError: null,
    closed: false,
    closing: false,
    isOpen: false,
    openResolve: null,
    openReject: null,
    pendingResolvers: [],
  };

  transcriptionSessions.set(sessionKey, session);

  const connection = await createDeepgramConnection(sessionKey);
  session.connection = connection;
  await waitForDeepgramOpen(session);

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
    outputSampleRate: TRANSCRIPTION_OUTPUT_SAMPLE_RATE,
    provider: "deepgram",
    model: DEEPGRAM_MODEL,
    language: DEEPGRAM_LANGUAGE,
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

    session.connection.send(normalizedAudioBuffer);

    const previousRevision = session.revision;
    const update = await waitForTranscriptUpdate(session, previousRevision);
    const transcriptResponse = createTranscriptResponse(session) || update;

    return res.json({
      text: transcriptResponse?.text || "",
      isFinal: !!transcriptResponse?.isFinal,
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

    const session = removeTranscriptionSession(sessionId);
    if (!session) {
      return res.json({
        success: true,
        text: "",
      });
    }

    const text = String(session.lastTranscript || "").trim();

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

const shutdownTranscriptionSessions = () => {
  Array.from(transcriptionSessions.keys()).forEach(sessionKey => {
    removeTranscriptionSession(sessionKey);
  });
};

process.on("exit", shutdownTranscriptionSessions);
process.on("SIGINT", () => {
  shutdownTranscriptionSessions();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdownTranscriptionSessions();
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
