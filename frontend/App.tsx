// ============================================================
// App.tsx - Entry Point
// Lobby screen to enter room name & participant name
// Then navigates to audio, video, or meeting video call
// ============================================================

import 'react-native-url-polyfill/auto';
import 'react-native-gesture-handler';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { registerGlobals } from '@livekit/react-native';
import VideoCallScreen from './src/screens/VideoCallScreen';
import AudioCallScreen from './src/screens/AudioCallScreen';
import MeetingScreen from './src/screens/MeetingScreen';
import type { CallType } from './src/types';

registerGlobals();

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

    if (!cameraGranted || !micGranted) {
      Alert.alert(
        'Permissions Required',
        'Camera and microphone permissions are required for video and meeting calls. Please enable them in Settings.',
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
  const [meetingModalVisible, setMeetingModalVisible] = useState(false);
  const [meetingMode, setMeetingMode] = useState<'create' | 'join' | null>(null);
  const [inMeeting, setInMeeting] = useState(false);
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    requestPermissions().then(setPermissionsGranted);
  }, []);

  const validateLobbyInputs = () => {
    const trimmedRoomName = roomName.trim();
    const trimmedParticipantName = participantName.trim();

    if (!trimmedRoomName) {
      setError('Please enter a room name');
      return null;
    }

    if (!trimmedParticipantName) {
      setError('Please enter your name');
      return null;
    }

    return {
      trimmedRoomName,
      trimmedParticipantName,
    };
  };

  const ensureCallPermissions = async () => {
    if (permissionsGranted) {
      return true;
    }

    const granted = await requestPermissions();
    if (!granted) {
      setError('Camera and microphone permissions are required');
      return false;
    }

    setPermissionsGranted(true);
    return true;
  };

  const handleJoinRoom = async (type: CallType) => {
    setError('');

    const inputs = validateLobbyInputs();
    if (!inputs) {
      return;
    }

    const granted = await ensureCallPermissions();
    if (!granted) {
      return;
    }

    console.log(`\n========================`);
    console.log(`  JOINING ROOM (${type.toUpperCase()})`);
    console.log(`  Room: ${inputs.trimmedRoomName}`);
    console.log(`  User: ${inputs.trimmedParticipantName}`);
    console.log(`========================\n`);

    setCallType(type);
    setInCall(true);
  };

  const handleMeetingEntry = async (mode: 'create' | 'join') => {
    setError('');

    const inputs = validateLobbyInputs();
    if (!inputs) {
      setMeetingModalVisible(false);
      return;
    }

    const granted = await ensureCallPermissions();
    if (!granted) {
      setMeetingModalVisible(false);
      return;
    }

    setMeetingMode(mode);
    setIsHost(mode === 'create');
    setMeetingModalVisible(false);
    setInMeeting(true);
  };

  const handleLeaveToLobby = () => {
    setInCall(false);
    setInMeeting(false);
    setMeetingMode(null);
    setIsHost(false);
    setRoomName('');
    setParticipantName('');
    setError('');
  };

  if (inCall) {
    if (callType === 'audio') {
      return (
        <AudioCallScreen
          roomName={roomName.trim()}
          participantName={participantName.trim()}
          onLeave={handleLeaveToLobby}
        />
      );
    }

    return (
      <VideoCallScreen
        roomName={roomName.trim()}
        participantName={participantName.trim()}
        onLeave={handleLeaveToLobby}
      />
    );
  }

  if (inMeeting && meetingMode) {
    return (
      <MeetingScreen
        roomName={roomName.trim()}
        participantName={participantName.trim()}
        onLeave={handleLeaveToLobby}
        isHost={isHost}
        mode={meetingMode}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <Text style={styles.logoIcon}>Infidhi</Text>
          <Text style={styles.title}>Video Call</Text>
          <Text style={styles.subtitle}>Powered by LiveKit</Text>
        </View>

        <View style={styles.formContainer}>
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

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={styles.joinButton}
            onPress={() => handleJoinRoom('audio')}
            activeOpacity={0.8}
          >
            <Text style={styles.joinButtonText}>Join Audio Call</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.joinButton, styles.videoCallButton]}
            onPress={() => handleJoinRoom('video')}
            activeOpacity={0.8}
          >
            <Text style={styles.joinButtonText}>Join Video Call</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.joinButton, styles.meetingButton]}
            onPress={() => setMeetingModalVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.joinButtonText}>Meeting</Text>
          </TouchableOpacity>

          <Modal
            visible={meetingModalVisible}
            animationType="fade"
            transparent
            onRequestClose={() => setMeetingModalVisible(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.meetingModal}>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setMeetingModalVisible(false)}
                  activeOpacity={0.7}
                  accessibilityLabel="Close meeting modal"
                >
                  <Text style={styles.closeButtonText}>x</Text>
                </TouchableOpacity>

                <Text style={styles.modalTitle}>Meeting</Text>

                <TouchableOpacity
                  style={[styles.meetingActionButton, styles.createMeetingButton]}
                  onPress={() => handleMeetingEntry('create')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.meetingActionText}>Create Meeting</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.meetingActionButton, styles.joinMeetingButton]}
                  onPress={() => handleMeetingEntry('join')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.meetingActionText}>Join Meeting</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        </View>

        <Text style={styles.footerText}>
          Enter the same room name on multiple devices to join the same room.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

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
    fontSize: 28,
    fontWeight: '700',
    color: '#6366f1',
    marginBottom: 16,
    letterSpacing: 2,
    textTransform: 'uppercase',
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
  meetingButton: {
    backgroundColor: '#6366f1',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  meetingModal: {
    backgroundColor: '#181826',
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 28,
    width: 310,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 26,
    marginTop: 8,
    letterSpacing: 0.1,
  },
  meetingActionButton: {
    width: 210,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 16,
  },
  createMeetingButton: {
    backgroundColor: '#22c55e',
  },
  joinMeetingButton: {
    backgroundColor: '#6366f1',
  },
  meetingActionText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});

export default App;
