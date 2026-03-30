// ============================================================
// AudioCallScreen
// Audio-only call screen — connects to LiveKit, no video
// ============================================================

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  FlatList,
} from 'react-native';
import {
  LiveKitRoom,
  useRoomContext,
  useParticipants,
  AudioSession,
} from '@livekit/react-native';
import { RoomEvent } from 'livekit-client';
import { API_BASE_URL } from '../config/api';
import type {
  AudioCallScreenProps,
  ParticipantInfo,
  ConnectionState,
  CreateTokenResponse,
} from '../types';
import AudioControlsBar from '../components/AudioControlsBar';
import ParticipantList from '../components/ParticipantList';

// AudioRoomContent (rendered inside LiveKitRoom)
interface AudioRoomContentProps {
  localParticipantId: string;
  localParticipantName: string;
  roomName: string;
  onLeave: () => void;
}

const AudioRoomContent: React.FC<AudioRoomContentProps> = ({
  localParticipantId,
  localParticipantName,
  roomName,
  onLeave,
}) => {
  const room = useRoomContext();
  const participants = useParticipants();
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [showParticipants, setShowParticipants] = useState(false);
  const mediaEnabledRef = useRef(false);
  const [, setTrackUpdate] = useState(0);

  // Debug: Monitor room events for connectivity
  useEffect(() => {
    const onStateChange = (state: string) => {
      console.log(`[Audio Room] Connection state changed: ${state}`);
    };
    const onParticipantConnected = (p: any) => {
      console.log(`[Audio Room] Remote participant connected: ${p.name || p.identity}`);
    };
    const onParticipantDisconnected = (p: any) => {
      console.log(`[Audio Room] Remote participant disconnected: ${p.name || p.identity}`);
    };
    const onTrackSubscribed = (track: any, pub: any, participant: any) => {
      console.log(`[Audio Room] Track subscribed: ${track.kind} from ${participant.name || participant.identity}`);
      setTrackUpdate(prev => prev + 1);
    };
    const onTrackUnsubscribed = (track: any, pub: any, participant: any) => {
      console.log(`[Audio Room] Track unsubscribed: ${track.kind} from ${participant.name || participant.identity}`);
      setTrackUpdate(prev => prev + 1);
    };

    room.on(RoomEvent.ConnectionStateChanged, onStateChange);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);

    console.log(`[Audio Room] Initial state: ${room.state}, Remote participants: ${room.remoteParticipants.size}`);

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onStateChange);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    };
  }, [room]);

  // Enable microphone only (no camera) — once on mount
  useEffect(() => {
    if (mediaEnabledRef.current) return;
    mediaEnabledRef.current = true;
    const enableMedia = async () => {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        console.log('[Audio] Mic enabled');
      } catch (error) {
        console.error('[Audio] Failed to enable mic:', error);
      }
    };
    enableMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build participant info list
  const participantInfoList: ParticipantInfo[] = useMemo(() => {
    return participants.map(p => ({
      id: p.identity,
      name: p.name || p.identity,
      joinedAt: new Date().toISOString(),
      isLocal: p.identity === localParticipantId,
    }));
  }, [participants, localParticipantId]);

  // Console log participant changes
  useEffect(() => {
    console.log(
      `\n[Audio Room: ${roomName}] Participants: ${participants.length}`,
    );
    participants.forEach(p => {
      console.log(`  - ${p.name || p.identity} (${p.identity})`);
    });
  }, [participants, roomName]);

  // Toggle microphone
  const handleToggleMic = useCallback(async () => {
    try {
      await room.localParticipant.setMicrophoneEnabled(!isMicEnabled);
      setIsMicEnabled(!isMicEnabled);
      console.log(`[Mic] ${!isMicEnabled ? 'Enabled' : 'Disabled'}`);
    } catch (error) {
      console.error('Failed to toggle mic:', error);
    }
  }, [room, isMicEnabled]);

  // Toggle speaker (loudspeaker)
  const handleToggleSpeaker = useCallback(async () => {
    try {
      await AudioSession.showAudioRoutePicker();
      setIsSpeakerOn(!isSpeakerOn);
      console.log(`[Speaker] ${!isSpeakerOn ? 'On' : 'Off'}`);
    } catch (error) {
      console.error('Failed to toggle speaker:', error);
    }
  }, [isSpeakerOn]);

  // Leave room
  const handleLeaveRoom = useCallback(async () => {
    try {
      console.log(`\n========================`);
      console.log(`  LEFT AUDIO ROOM ${roomName}`);
      console.log(`========================\n`);

      // Notify backend
      try {
        await fetch(`${API_BASE_URL}/leave-room`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomName,
            participantId: localParticipantId,
          }),
        });
      } catch {
        // Backend notification is best-effort
      }

      await room.disconnect();
      onLeave();
    } catch (error) {
      console.error('Failed to leave room:', error);
      onLeave();
    }
  }, [room, roomName, localParticipantId, onLeave]);

  // Render a single participant avatar tile
  const renderParticipant = useCallback(
    ({ item }: { item: (typeof participants)[0] }) => {
      const isLocal = item.identity === localParticipantId;
      const name = item.name || item.identity;
      const initials = name
        .split(' ')
        .map((w: string) => w[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);

      return (
        <View style={styles.participantTile}>
          <View
            style={[
              styles.avatarCircle,
              item.isSpeaking && styles.avatarSpeaking,
            ]}
          >
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.participantName} numberOfLines={1}>
            {name}
            {isLocal ? ' (You)' : ''}
          </Text>
          {item.isSpeaking && (
            <Text style={styles.speakingIndicator}>🔊 Speaking</Text>
          )}
        </View>
      );
    },
    [localParticipantId],
  );

  return (
    <View style={styles.roomContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />

      {/* Room Header */}
      <View style={styles.roomHeader}>
        <Text style={styles.roomTitle}>🎙️ {roomName}</Text>
        <Text style={styles.roomSubtitle}>
          Audio Call • {participants.length} participant
          {participants.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Call Duration / Status */}
      <View style={styles.callStatusContainer}>
        <Text style={styles.callStatusIcon}>📞</Text>
        <Text style={styles.callStatusText}>Audio Call In Progress</Text>
      </View>

      {/* Participants Grid */}
      <FlatList
        data={participants}
        keyExtractor={item => item.identity}
        renderItem={renderParticipant}
        numColumns={3}
        contentContainerStyle={styles.participantGrid}
        columnWrapperStyle={styles.participantRow}
        style={styles.participantList}
      />

      {/* Audio Controls Bar */}
      <AudioControlsBar
        isMicEnabled={isMicEnabled}
        isSpeakerOn={isSpeakerOn}
        onToggleMic={handleToggleMic}
        onToggleSpeaker={handleToggleSpeaker}
        onLeaveRoom={handleLeaveRoom}
      />

      {/* Participant List Modal (reuse existing component) */}
      <ParticipantList
        participants={participantInfoList}
        visible={showParticipants}
        onClose={() => setShowParticipants(false)}
      />
    </View>
  );
};

// AudioCallScreen (Main Exported Component)
const AudioCallScreen: React.FC<AudioCallScreenProps> = ({
  roomName,
  participantName,
  onLeave,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string>('');
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [audioReady, setAudioReady] = useState(false);

  // Fetch token from backend (same as VideoCallScreen)
  useEffect(() => {
    const fetchToken = async () => {
      setConnectionState('connecting');
      try {
        console.log(
          `\n[Audio Connecting] Room: ${roomName}, User: ${participantName}`,
        );
        console.log(`[API URL] ${API_BASE_URL}/create-token`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(`${API_BASE_URL}/create-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
          },
          body: JSON.stringify({ roomName, participantName }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Server error ${response.status}: ${text}`);
        }

        const data: CreateTokenResponse = await response.json();
        console.log(`[Token Received] ID: ${data.participantId}`);
        console.log(`[LiveKit URL] ${data.livekitUrl}`);

        if (!data.token || !data.livekitUrl) {
          throw new Error('Invalid response: missing token or livekitUrl');
        }

        setToken(data.token);
        setLivekitUrl(data.livekitUrl);
        setParticipantId(data.participantId);
        setConnectionState('connected');
      } catch (error: any) {
        console.error('[Connection Error]', error.message);
        setConnectionState('error');
        if (error.name === 'AbortError') {
          setErrorMessage('Request timed out. Is the backend server running?');
        } else if (error.message?.includes('Network request failed')) {
          setErrorMessage(
            'Cannot reach server. Check that backend is running and ngrok URL is correct.',
          );
        } else {
          setErrorMessage(error.message || 'Failed to connect');
        }
      }
    };

    fetchToken();
  }, [roomName, participantName]);

  // Configure audio session — MUST complete before LiveKitRoom connects
  useEffect(() => {
    const configureAudio = async () => {
      try {
        await AudioSession.configureAudio({
          android: {
            preferredOutputList: ['speaker'],
            audioTypeOptions: {
              manageAudioFocus: true,
              audioMode: 'inCommunication',
              audioStreamType: 'voiceCall',
              audioFocusMode: 'gain',
              audioAttributesUsageType: 'voiceCommunication',
              audioAttributesContentType: 'speech',
              forceHandleAudioRouting: true,
            },
          },
          ios: {
            defaultOutput: 'speaker',
          },
        });
        await AudioSession.startAudioSession();
        console.log('[Audio] Session configured and started');
        setAudioReady(true);
      } catch (error) {
        console.error('Failed to start audio session:', error);
        setAudioReady(true); // still allow connection attempt
      }
    };

    configureAudio();

    return () => {
      void AudioSession.stopAudioSession().catch(error => {
        console.warn('[Audio] Failed to stop audio session:', error);
      });
    };
  }, []);

  // Handle connection events
  const handleConnected = useCallback(() => {
    setConnectionState('connected');
    console.log(`\n========================`);
    console.log(`  CONNECTED TO AUDIO ROOM`);
    console.log(`  Room: ${roomName}`);
    console.log(`========================\n`);
  }, [roomName]);

  const handleDisconnected = useCallback(() => {
    setConnectionState('disconnected');
    console.log(`[Disconnected] Audio Room: ${roomName}`);
  }, [roomName]);

  const handleError = useCallback((error: any) => {
    console.error('[Room Error]', error);
    setConnectionState('error');
    setErrorMessage(error?.message || 'Connection error');
  }, []);

  // Loading state
  if (connectionState === 'connecting') {
    return (
      <View style={styles.centerContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Connecting to audio call...</Text>
        <Text style={styles.loadingSubtext}>{roomName}</Text>
      </View>
    );
  }

  // Error state
  if (connectionState === 'error') {
    return (
      <View style={styles.centerContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>Connection Failed</Text>
        <Text style={styles.errorSubtext}>{errorMessage}</Text>
        <Text style={styles.retryText} onPress={onLeave}>
          Go Back
        </Text>
      </View>
    );
  }

  // Connected — render LiveKit room with audio only (only after audio session is ready)
  if (token && livekitUrl && audioReady) {
    return (
      <LiveKitRoom
        serverUrl={livekitUrl}
        token={token}
        connect={true}
        options={{
          adaptiveStream: false,
          dynacast: false,
        }}
        connectOptions={{
          autoSubscribe: true,
        }}
        audio={true}
        video={false}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onError={handleError}
      >
        <AudioRoomContent
          localParticipantId={participantId}
          localParticipantName={participantName}
          roomName={roomName}
          onLeave={onLeave}
        />
      </LiveKitRoom>
    );
  }

  return null;
};

// Styles
const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
  },
  loadingSubtext: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 8,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 20,
    fontWeight: '700',
  },
  errorSubtext: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  retryText: {
    color: '#6366f1',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 24,
    textDecorationLine: 'underline',
  },
  roomContainer: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  roomHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0f0f23',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  roomTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  roomSubtitle: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  callStatusContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  callStatusIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  callStatusText: {
    color: '#10b981',
    fontSize: 16,
    fontWeight: '600',
  },
  participantList: {
    flex: 1,
  },
  participantGrid: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  participantRow: {
    justifyContent: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  participantTile: {
    alignItems: 'center',
    width: '30%',
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  avatarSpeaking: {
    borderColor: '#10b981',
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '700',
  },
  participantName: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: 90,
  },
  speakingIndicator: {
    color: '#10b981',
    fontSize: 11,
    marginTop: 4,
  },
});

export default AudioCallScreen;
