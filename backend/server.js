const express = require("express");
const cors = require("cors");
const { AccessToken } = require("livekit-server-sdk");
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

// ============================================================
// In-memory room tracking
// ============================================================
const rooms = new Map();
// rooms structure: Map<roomName, Map<participantId, { name, uuid, joinedAt }>>
const meetings = new Map();

app.use(cors());
app.use(express.json());

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
app.post("/leave-room", (req, res) => {
  try {
    const { roomName, participantId } = req.body;

    if (!roomName || !participantId) {
      return res.status(400).json({
        error: "Missing required fields: roomName and participantId",
      });
    }

    const participant = removeParticipantFromRoom(roomName, participantId);
    const room = rooms.get(roomName);

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
    if (existingMeeting && !existingMeeting.ended) {
      return res.status(409).json({
        error: "A meeting for this room already exists",
      });
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
app.post("/meetings/kick", (req, res) => {
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
app.post("/meetings/leave", (req, res) => {
  try {
    const { roomName, participantId } = req.body;
    const meeting = getMeeting(roomName);

    if (!meeting) {
      return res.json({ success: true });
    }

    if (participantId === meeting.hostParticipantId) {
      meeting.ended = true;
      meeting.participantStatuses.forEach((_, activeParticipantId) => {
        if (activeParticipantId !== participantId) {
          meeting.participantStatuses.set(activeParticipantId, "ended");
        }
      });
    } else {
      meeting.participantStatuses.delete(participantId);
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
