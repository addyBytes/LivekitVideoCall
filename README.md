# LiveKit Video Call System

A complete multi-user video calling application using **React Native CLI** (TypeScript) + **Node.js/Express** backend + **LiveKit SFU**.

---

## Project Structure

```
videocall/
├── backend/
│   ├── server.js          # Express server (port 5002)
│   ├── package.json
│   └── .env.example       # Environment variable template
│
├── frontend/
│   ├── App.tsx             # Entry point (Lobby screen)
│   ├── index.js            # React Native entry
│   ├── app.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── babel.config.js
│   ├── metro.config.js
│   └── src/
│       ├── config/
│       │   └── api.ts      # API URL configuration
│       ├── types/
│       │   └── index.ts    # TypeScript interfaces
│       ├── screens/
│       │   └── VideoCallScreen.tsx
│       └── components/
│           ├── VideoTile.tsx
│           ├── ParticipantList.tsx
│           └── ControlsBar.tsx
│
└── README.md
```

---

## Prerequisites

- **Node.js** >= 18
- **npm** or **yarn**
- **React Native CLI** environment set up ([official docs](https://reactnative.dev/docs/environment-setup))
- **Android Studio** (for Android) or **Xcode** (for iOS/macOS)
- **LiveKit Cloud** account (free at [cloud.livekit.io](https://cloud.livekit.io))
- **ngrok** (for testing on physical devices)

---

## Setup Instructions

### 1. Clone / Navigate to the Project

```bash
cd videocall
```

### 2. Backend Setup

```bash
cd backend
npm install
```

**Configure credentials:**

```bash
# Copy the example .env file
cp .env.example .env
```

Edit `.env` with your LiveKit credentials:

```env
LIVEKIT_API_KEY=your_actual_api_key
LIVEKIT_API_SECRET=your_actual_api_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
```

Or directly edit the placeholders in `server.js`.

**Start the server:**

```bash
npm start
# or for development with auto-reload:
npm run dev
```

The server runs at **http://localhost:5002**.

### 3. Frontend Setup

```bash
cd frontend
```

**Option A: Initialize a fresh React Native project and copy source files**

If you don't have a React Native project yet:

```bash
# Create the React Native project (from parent directory)
npx react-native@latest init VideoCallFrontend --template react-native-template-typescript

# Then copy the src/ folder, App.tsx, and config files into the generated project
```

**Option B: Install dependencies in the existing structure**

```bash
npm install
```

**Install required native dependencies:**

```bash
npm install @livekit/react-native @livekit/react-native-webrtc
npm install react-native-url-polyfill react-native-gesture-handler
npm install react-native-safe-area-context uuid
npm install --save-dev @types/uuid
```

**For iOS (macOS only):**

```bash
cd ios && pod install && cd ..
```

**Configure the API URL:**

Edit `src/config/api.ts`:

```typescript
// For Android Emulator:
export const API_BASE_URL = "http://10.0.2.2:5002";

// For iOS Simulator:
export const API_BASE_URL = "http://localhost:5002";

// For physical devices (use ngrok):
// 1. Run: ngrok http 5002
// 2. Copy the URL and set:
export const API_BASE_URL = "https://your-ngrok-url.ngrok.io";
```

### 4. Android Permissions

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.INTERNET" />
```

### 5. iOS Permissions (macOS only)

Add to `ios/VideoCallFrontend/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>This app needs camera access for video calls</string>
<key>NSMicrophoneUsageDescription</key>
<string>This app needs microphone access for video calls</string>
```

---

## Running the App

### Start Backend

```bash
cd backend
npm start
```

### Start Metro Bundler

```bash
cd frontend
npm start
```

### Run on Android

```bash
npm run android
```

### Run on iOS

```bash
npm run ios
```

---

## Environment Variables (.env format)

### Backend `.env`

```env
LIVEKIT_API_KEY=YOUR_LIVEKIT_API_KEY
LIVEKIT_API_SECRET=YOUR_LIVEKIT_API_SECRET
LIVEKIT_URL=wss://YOUR_LIVEKIT_CLOUD_URL
PORT=5002
```

---

## How It Works

1. **Lobby Screen** — User enters room name and display name
2. **Token Request** — App sends `POST /create-token` to backend
3. **Backend** — Generates a LiveKit JWT token with room permissions
4. **Connection** — App connects to LiveKit Cloud using the token
5. **Video Grid** — Dynamically renders participant videos in a responsive grid
6. **Controls** — Mute/unmute, camera on/off, view participants, leave room

### Video Grid Layout

| Participants | Layout                                           |
| ------------ | ------------------------------------------------ |
| 1            | Full screen                                      |
| 2            | Split (vertical portrait / horizontal landscape) |
| 3-4          | 2×2 grid                                         |
| 5-6          | Responsive wrapping grid                         |
| 7+           | Auto-wrapping multi-column grid                  |

---

## API Endpoints

### `POST /create-token`

**Request:**

```json
{
  "roomName": "team-standup",
  "participantName": "Aditya"
}
```

**Response:**

```json
{
  "token": "eyJ...",
  "livekitUrl": "wss://your-project.livekit.cloud",
  "participantId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### `POST /leave-room`

**Request:**

```json
{
  "roomName": "team-standup",
  "participantId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### `GET /rooms`

Returns all active rooms and participants (debug endpoint).

### `GET /`

Health check endpoint.

---

## Testing with ngrok

```bash
# Install ngrok
npm install -g ngrok

# Expose your backend
ngrok http 5002

# Copy the HTTPS URL and update frontend/src/config/api.ts
```

---

## Troubleshooting

| Issue                    | Solution                                                                       |
| ------------------------ | ------------------------------------------------------------------------------ |
| `Network request failed` | Check API_BASE_URL in `src/config/api.ts`. Use `10.0.2.2` for Android emulator |
| Camera/mic not working   | Ensure permissions are added to AndroidManifest.xml / Info.plist               |
| Black video tiles        | Check LiveKit Cloud URL and API credentials                                    |
| Build fails on iOS       | Run `cd ios && pod install`                                                    |
| `registerGlobals` error  | Ensure `@livekit/react-native` is properly installed                           |

---

## Tech Stack

- **Frontend:** React Native CLI, TypeScript, LiveKit React Native SDK
- **Backend:** Node.js, Express, LiveKit Server SDK, JavaScript
- **SFU:** LiveKit Cloud
- **Protocol:** WebRTC (via LiveKit)

---

## Placeholders to Replace

Search for these in the codebase and replace with your values:

- `YOUR_LIVEKIT_API_KEY` — LiveKit API Key
- `YOUR_LIVEKIT_API_SECRET` — LiveKit API Secret
- `YOUR_LIVEKIT_CLOUD_URL` — LiveKit Cloud WebSocket URL
- `YOUR_NGROK_URL` — Your ngrok tunnel URL

---

## License

MIT
