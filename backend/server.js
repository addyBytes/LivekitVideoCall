// ============================================================
// LiveKit Video Call Backend Server
// ============================================================
// TODO: Replace with your API Key
// TODO: Replace with your API Secret
// TODO: Replace with your LiveKit Cloud URL
// ============================================================

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

    // Generate unique participant ID
    const participantId = uuidv4();

    // Create LiveKit Access Token
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: participantId,
      name: participantName,
    });

    // Grant permissions for the room
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    // Track participant in room
    if (!rooms.has(roomName)) {
      rooms.set(roomName, new Map());
    }
    const room = rooms.get(roomName);
    room.set(participantId, {
      name: participantName,
      uuid: participantId,
      joinedAt: new Date().toISOString(),
    });

    const totalParticipants = room.size;
    const timestamp = new Date().toISOString();

    // Console logging with formatted output
    console.log("\n========================");
    console.log("   NEW PARTICIPANT JOINED");
    console.log("========================");
    console.log(`  Room:               ${roomName}`);
    console.log(`  User:               ${participantName}`);
    console.log(`  UUID:               ${participantId}`);
    console.log(`  Token:              ${jwt.substring(0, 40)}...`);
    console.log(`  Timestamp:          ${timestamp}`);
    console.log(`  Total Participants: ${totalParticipants}`);
    console.log("========================\n");

    // Return response
    return res.json({
      token: jwt,
      livekitUrl: LIVEKIT_URL,
      participantId,
    });
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

    const room = rooms.get(roomName);
    if (room) {
      const participant = room.get(participantId);
      room.delete(participantId);

      // Clean up empty rooms
      if (room.size === 0) {
        rooms.delete(roomName);
      }

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
