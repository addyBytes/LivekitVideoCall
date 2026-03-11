// ============================================================
// App.tsx - Entry Point
// Lobby screen to enter room name & participant name
// Then navigates to VideoCallScreen
// ============================================================

import 'react-native-url-polyfill/auto';
import 'react-native-gesture-handler';

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  PermissionsAndroid,
  Alert,
} from 'react-native';
import { registerGlobals } from '@livekit/react-native';
import VideoCallScreen from './src/screens/VideoCallScreen';
import AudioCallScreen from './src/screens/AudioCallScreen';
import type { CallType } from './src/types';

// Register LiveKit globals (WebRTC polyfills)
registerGlobals();

// ============================================================
// Request Camera & Microphone Permissions (Android)
// ============================================================
const requestPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);

    const cameraGranted =
      granted[PermissionsAndroid.PERMISSIONS.CAMERA] ===
      PermissionsAndroid.RESULTS.GRANTED;
    const micGranted =
      granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
      PermissionsAndroid.RESULTS.GRANTED;

    console.log(`[Permissions] Camera: ${cameraGranted}, Mic: ${micGranted}`);

    if (!cameraGranted || !micGranted) {
      Alert.alert(
        'Permissions Required',
        'Camera and microphone permissions are required to make video calls. Please enable them in Settings.',
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Permissions] Error requesting permissions:', err);
    return false;
  }
};

const App: React.FC = () => {
  const [roomName, setRoomName] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [inCall, setInCall] = useState(false);
  const [callType, setCallType] = useState<CallType>('video');
  const [error, setError] = useState('');
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  // Request permissions on app launch
  useEffect(() => {
    requestPermissions().then(granted => {
      setPermissionsGranted(granted);
    });
  }, []);

  const handleJoinRoom = async (type: CallType) => {
    setError('');

    if (!roomName.trim()) {
      setError('Please enter a room name');
      return;
    }
    if (!participantName.trim()) {
      setError('Please enter your name');
      return;
    }

    // Re-check permissions before joining
    if (!permissionsGranted) {
      const granted = await requestPermissions();
      if (!granted) {
        setError('Camera and microphone permissions are required');
        return;
      }
      setPermissionsGranted(true);
    }

    console.log(`\n========================`);
    console.log(`  JOINING ROOM (${type.toUpperCase()})`);
    console.log(`  Room: ${roomName.trim()}`);
    console.log(`  User: ${participantName.trim()}`);
    console.log(`========================\n`);

    setCallType(type);
    setInCall(true);
  };

  const handleLeaveCall = () => {
    setInCall(false);
    setRoomName('');
    setParticipantName('');
  };

  // If in a call, show the appropriate screen
  if (inCall) {
    if (callType === 'audio') {
      return (
        <AudioCallScreen
          roomName={roomName.trim()}
          participantName={participantName.trim()}
          onLeave={handleLeaveCall}
        />
      );
    }
    return (
      <VideoCallScreen
        roomName={roomName.trim()}
        participantName={participantName.trim()}
        onLeave={handleLeaveCall}
      />
    );
  }

  // Lobby screen
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Logo / Title */}
        <View style={styles.header}>
          <Text style={styles.logoIcon}>📹</Text>
          <Text style={styles.title}>Video Call</Text>
          <Text style={styles.subtitle}>Powered by LiveKit</Text>
        </View>

        {/* Form */}
        <View style={styles.formContainer}>
          {/* Room Name Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Room Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., team-standup"
              placeholderTextColor="#4b5563"
              value={roomName}
              onChangeText={setRoomName}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Participant Name Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Your Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Aditya"
              placeholderTextColor="#4b5563"
              value={participantName}
              onChangeText={setParticipantName}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          {/* Error Message */}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* Join Audio Call Button */}
          <TouchableOpacity
            style={styles.joinButton}
            onPress={() => handleJoinRoom('audio')}
            activeOpacity={0.8}
          >
            <Text style={styles.joinButtonText}>🎙️  Join Audio Call</Text>
          </TouchableOpacity>

          {/* Join Video Call Button */}
          <TouchableOpacity
            style={[styles.joinButton, styles.videoCallButton]}
            onPress={() => handleJoinRoom('video')}
            activeOpacity={0.8}
          >
            <Text style={styles.joinButtonText}>📹  Join Video Call</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={styles.footerText}>
          Enter the same room name on multiple devices to join the same call
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ============================================================
// Styles (Dark Theme)
// ============================================================
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#6366f1',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },
  formContainer: {
    width: '100%',
    maxWidth: 400,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
  },
  input: {
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.2)',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    color: '#ffffff',
    fontSize: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    marginBottom: 12,
    marginLeft: 4,
  },
  joinButton: {
    backgroundColor: '#6366f1',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  videoCallButton: {
    backgroundColor: '#10b981',
    shadowColor: '#10b981',
    marginTop: 12,
  },
  joinButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  footerText: {
    color: '#4b5563',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 32,
    paddingHorizontal: 16,
    lineHeight: 18,
  },
});

export default App;
