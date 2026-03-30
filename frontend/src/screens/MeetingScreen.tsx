// Same Video Calling But with Meeting Features
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AudioSession,
  LiveKitRoom,
  useParticipants,
  useRoomContext,
} from '@livekit/react-native';
import { API_BASE_URL } from '../config/api';
import { VideoRoomContent } from './VideoCallScreen';
import type {
  ConnectionState,
  CreateTokenResponse,
  MeetingScreenProps,
  MeetingWaitingParticipant,
} from '../types';

const WAITING_ROOM_POLL_INTERVAL = 2000;
const PARTICIPANT_STATUS_POLL_INTERVAL = 2500;

interface MeetingRequestResponse {
  requestId: string;
  status: 'waiting';
}

interface MeetingRequestStatusResponse {
  status: 'waiting' | 'admitted' | 'removed' | 'ended';
  token?: string;
  livekitUrl?: string;
  participantId?: string;
  message?: string;
}

interface MeetingParticipantStatusResponse {
  status: 'active' | 'kicked' | 'ended';
  message?: string;
}

interface WaitingRoomResponse {
  waitingParticipants: MeetingWaitingParticipant[];
}

interface MeetingStatusWatcherProps {
  roomName: string;
  participantId: string;
  onForcedExit: (message: string) => Promise<void>;
}

// Keep polling the participant status so kicked or ended sessions leave cleanly.
const MeetingStatusWatcher: React.FC<MeetingStatusWatcherProps> = ({
  roomName,
  participantId,
  onForcedExit,
}) => {
  const room = useRoomContext();
  const handledExitRef = useRef(false);

  useEffect(() => {
    if (!participantId) {
      return;
    }

    let mounted = true;

    const pollParticipantStatus = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/meetings/participant-status?roomName=${encodeURIComponent(
            roomName,
          )}&participantId=${encodeURIComponent(participantId)}`,
        );
        const data: MeetingParticipantStatusResponse = await response.json();

        if (!mounted || handledExitRef.current || data.status === 'active') {
          return;
        }

        handledExitRef.current = true;

        try {
          await room.disconnect();
        } catch (disconnectError) {
          console.warn('[Meeting] Failed to disconnect after forced exit:', disconnectError);
        }

        await onForcedExit(
          data.message ||
            (data.status === 'kicked'
              ? 'Host removed you from the meeting.'
              : 'Meeting ended.'),
        );
      } catch (error) {
        console.warn('[Meeting] Failed to poll participant status:', error);
      }
    };

    pollParticipantStatus();
    const interval = setInterval(
      pollParticipantStatus,
      PARTICIPANT_STATUS_POLL_INTERVAL,
    );

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [onForcedExit, participantId, room, roomName]);

  return null;
};

interface MeetingHostControlsProps {
  roomName: string;
  hostParticipantId: string;
  hiddenParticipantIds: string[];
  onParticipantKicked: (participantId: string) => void;
}

// Let the host manage waiting-room requests and active participants from one panel.
const MeetingHostControls: React.FC<MeetingHostControlsProps> = ({
  roomName,
  hostParticipantId,
  hiddenParticipantIds,
  onParticipantKicked,
}) => {
  const participants = useParticipants();
  const [showManagementModal, setShowManagementModal] = useState(false);
  const [waitingParticipants, setWaitingParticipants] = useState<
    MeetingWaitingParticipant[]
  >([]);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  const loadWaitingParticipants = useCallback(async () => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/meetings/waiting-room?roomName=${encodeURIComponent(
          roomName,
        )}&hostParticipantId=${encodeURIComponent(hostParticipantId)}`,
      );

      if (!response.ok) {
        return;
      }

      const data: WaitingRoomResponse = await response.json();
      setWaitingParticipants(data.waitingParticipants || []);
    } catch (error) {
      console.warn('[Meeting] Failed to load waiting room:', error);
    }
  }, [hostParticipantId, roomName]);

  useEffect(() => {
    loadWaitingParticipants();
    const interval = setInterval(loadWaitingParticipants, WAITING_ROOM_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadWaitingParticipants]);

  const admitParticipant = useCallback(
    async (requestId: string) => {
      setActiveActionId(requestId);
      try {
        await fetch(`${API_BASE_URL}/meetings/admit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomName,
            hostParticipantId,
            requestId,
          }),
        });
        await loadWaitingParticipants();
      } catch (error) {
        console.warn('[Meeting] Failed to admit participant:', error);
      } finally {
        setActiveActionId(null);
      }
    },
    [hostParticipantId, loadWaitingParticipants, roomName],
  );

  const removeWaitingParticipant = useCallback(
    async (requestId: string) => {
      setActiveActionId(requestId);
      try {
        await fetch(`${API_BASE_URL}/meetings/remove-waiting`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomName,
            hostParticipantId,
            requestId,
          }),
        });
        await loadWaitingParticipants();
      } catch (error) {
        console.warn('[Meeting] Failed to remove waiting participant:', error);
      } finally {
        setActiveActionId(null);
      }
    },
    [hostParticipantId, loadWaitingParticipants, roomName],
  );

  const kickParticipant = useCallback(
    async (participantId: string) => {
      setActiveActionId(participantId);
      try {
        const response = await fetch(`${API_BASE_URL}/meetings/kick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomName,
            hostParticipantId,
            participantId,
          }),
        });
        if (response.ok) {
          onParticipantKicked(participantId);
        }
      } catch (error) {
        console.warn('[Meeting] Failed to kick participant:', error);
      } finally {
        setActiveActionId(null);
      }
    },
    [hostParticipantId, onParticipantKicked, roomName],
  );

  const activeParticipants = useMemo(
    () =>
      participants
        .filter(
          participant => !hiddenParticipantIds.includes(participant.identity),
        )
        .map(participant => ({
          id: participant.identity,
          name: participant.name || participant.identity,
          isHost: participant.identity === hostParticipantId,
        })),
    [hiddenParticipantIds, hostParticipantId, participants],
  );

  return (
    <>
      <TouchableOpacity
        style={styles.manageButton}
        onPress={() => setShowManagementModal(true)}
        activeOpacity={0.85}
      >
        <Text style={styles.manageButtonText}>
          Manage ({waitingParticipants.length})
        </Text>
      </TouchableOpacity>

      <Modal
        visible={showManagementModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowManagementModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.managementModal}>
            <Text style={styles.managementTitle}>Meeting Controls</Text>

            <ScrollView
              style={styles.managementScroll}
              contentContainerStyle={styles.managementScrollContent}
            >
              <Text style={styles.sectionTitle}>Waiting Room</Text>
              {waitingParticipants.length === 0 ? (
                <Text style={styles.emptyText}>No one is waiting right now.</Text>
              ) : (
                waitingParticipants.map(item => (
                  <View style={styles.managementRow} key={item.requestId}>
                    <View style={styles.managementInfo}>
                      <Text style={styles.managementName}>
                        {item.participantName}
                      </Text>
                      <Text style={styles.managementMeta}>Waiting to join</Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.actionButton, styles.admitButton]}
                      onPress={() => admitParticipant(item.requestId)}
                      disabled={activeActionId === item.requestId}
                    >
                      <Text style={styles.actionButtonText}>Admit</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionButton, styles.removeButton]}
                      onPress={() => removeWaitingParticipant(item.requestId)}
                      disabled={activeActionId === item.requestId}
                    >
                      <Text style={styles.actionButtonText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}

              <Text style={styles.sectionTitle}>In Meeting</Text>
              {activeParticipants.length === 0 ? (
                <Text style={styles.emptyText}>No one is in the meeting yet.</Text>
              ) : (
                activeParticipants.map(item => (
                  <View style={styles.managementRow} key={item.id}>
                    <View style={styles.managementInfo}>
                      <Text style={styles.managementName}>{item.name}</Text>
                      <Text style={styles.managementMeta}>
                        {item.isHost ? 'Host' : 'Participant'}
                      </Text>
                    </View>

                    {item.isHost ? (
                      <View style={[styles.actionButton, styles.hostBadge]}>
                        <Text style={styles.actionButtonText}>Host</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.actionButton, styles.removeButton]}
                        onPress={() => kickParticipant(item.id)}
                        disabled={activeActionId === item.id}
                      >
                        <Text style={styles.actionButtonText}>Kick</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => setShowManagementModal(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.closeModalButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const MeetingScreen: React.FC<MeetingScreenProps> = ({
  roomName,
  participantName,
  onLeave,
  isHost,
  mode,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState('');
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [audioReady, setAudioReady] = useState(false);
  const [waitingRequestId, setWaitingRequestId] = useState<string | null>(null);
  const [waitingForAdmission, setWaitingForAdmission] = useState(!isHost);
  const [hiddenParticipantIds, setHiddenParticipantIds] = useState<string[]>([]);
  const leavingRef = useRef(false);

  // Clear backend room state before leaving so the meeting can be recreated cleanly.
  const leaveMeetingState = useCallback(
    async (message?: string) => {
      if (leavingRef.current) {
        return;
      }

      leavingRef.current = true;

      try {
        if (participantId) {
          try {
            await fetch(`${API_BASE_URL}/leave-room`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                roomName,
                participantId,
              }),
            });
          } catch (leaveRoomError) {
            console.warn('[Meeting] Failed to notify room leave:', leaveRoomError);
          }

          await fetch(`${API_BASE_URL}/meetings/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomName,
              participantId,
            }),
          });
        } else if (waitingRequestId) {
          await fetch(`${API_BASE_URL}/meetings/cancel-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomName,
              requestId: waitingRequestId,
            }),
          });
        }
      } catch (error) {
        console.warn('[Meeting] Failed to notify backend on leave:', error);
      } finally {
        if (message) {
          Alert.alert('Meeting Update', message);
        }
        onLeave();
      }
    },
    [onLeave, participantId, roomName, waitingRequestId],
  );

  // Prepare the audio session before joining the LiveKit meeting.
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
        setAudioReady(true);
      } catch (error) {
        console.error('[Meeting] Failed to start audio session:', error);
        setAudioReady(true);
      }
    };

    configureAudio();

    return () => {
      void AudioSession.stopAudioSession().catch(error => {
        console.warn('[Meeting] Failed to stop audio session:', error);
      });
    };
  }, []);

  // Create the meeting token for hosts or wait for host admission for guests.
  useEffect(() => {
    const startMeetingFlow = async () => {
      setConnectionState('connecting');
      setErrorMessage('');

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const endpoint = isHost
          ? `${API_BASE_URL}/meetings/create`
          : `${API_BASE_URL}/meetings/request-access`;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
          },
          body: JSON.stringify({ roomName, participantName }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to start meeting');
        }

        if (isHost) {
          const access = data as CreateTokenResponse;
          setToken(access.token);
          setLivekitUrl(access.livekitUrl);
          setParticipantId(access.participantId);
          setWaitingForAdmission(false);
          setConnectionState('connected');
          return;
        }

        const request = data as MeetingRequestResponse;
        setWaitingRequestId(request.requestId);
        setWaitingForAdmission(true);
        setConnectionState('idle');
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to start meeting';
        console.error('[Meeting] Start flow failed:', message);
        setConnectionState('error');
        setErrorMessage(message);
      }
    };

    startMeetingFlow();
  }, [isHost, participantName, roomName]);

  // Keep guests polling until they are admitted, removed, or the meeting ends.
  useEffect(() => {
    if (isHost || !waitingRequestId || token) {
      return;
    }

    let mounted = true;

    const pollAdmissionStatus = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/meetings/request-status?roomName=${encodeURIComponent(
            roomName,
          )}&requestId=${encodeURIComponent(waitingRequestId)}`,
        );
        const data: MeetingRequestStatusResponse = await response.json();

        if (!mounted) {
          return;
        }

        if (data.status === 'admitted' && data.token && data.livekitUrl && data.participantId) {
          setToken(data.token);
          setLivekitUrl(data.livekitUrl);
          setParticipantId(data.participantId);
          setWaitingForAdmission(false);
          setConnectionState('connected');
          return;
        }

        if (data.status === 'removed' || data.status === 'ended') {
          setWaitingForAdmission(false);
          setConnectionState('error');
          setErrorMessage(
            data.message ||
              (data.status === 'removed'
                ? 'Host removed your request.'
                : 'Meeting ended before you joined.'),
          );
        }
      } catch (error) {
        console.warn('[Meeting] Failed to poll waiting room status:', error);
      }
    };

    pollAdmissionStatus();
    const interval = setInterval(pollAdmissionStatus, WAITING_ROOM_POLL_INTERVAL);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isHost, roomName, token, waitingRequestId]);

  const waitingMessage =
    mode === 'join'
      ? 'Waiting for the host to admit you...'
      : 'Preparing your meeting...';

  if (connectionState === 'error') {
    return (
      <View style={styles.centerContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />
        <Text style={styles.errorTitle}>Meeting Failed</Text>
        <Text style={styles.errorMessage}>{errorMessage}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => leaveMeetingState()}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isHost && waitingForAdmission && !token) {
    return (
      <View style={styles.centerContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.waitingTitle}>{waitingMessage}</Text>
        <Text style={styles.waitingSubtitle}>{roomName}</Text>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => leaveMeetingState()}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryButtonText}>Leave</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (connectionState === 'connecting' || !audioReady || !token || !livekitUrl) {
    return (
      <View style={styles.centerContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.waitingTitle}>Connecting to meeting...</Text>
        <Text style={styles.waitingSubtitle}>{roomName}</Text>
      </View>
    );
  }

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
      audio={false}
      video={false}
      onConnected={() => setConnectionState('connected')}
      onDisconnected={() => setConnectionState('disconnected')}
      onError={error => {
        console.error('[Meeting] Room error:', error);
        setConnectionState('error');
        setErrorMessage(error?.message || 'Connection error');
      }}
    >
      {!isHost && participantId ? (
        <MeetingStatusWatcher
          roomName={roomName}
          participantId={participantId}
          onForcedExit={leaveMeetingState}
        />
      ) : null}

      {isHost && participantId ? (
        <MeetingHostControls
          roomName={roomName}
          hostParticipantId={participantId}
          hiddenParticipantIds={hiddenParticipantIds}
          onParticipantKicked={kickedParticipantId => {
            setHiddenParticipantIds(currentIds =>
              currentIds.includes(kickedParticipantId)
                ? currentIds
                : [...currentIds, kickedParticipantId],
            );
          }}
        />
      ) : null}

      <VideoRoomContent
        localParticipantId={participantId}
        localParticipantName={participantName}
        roomName={roomName}
        onLeave={leaveMeetingState}
        hiddenParticipantIds={hiddenParticipantIds}
        enableTranscription={true}
      />
    </LiveKitRoom>
  );
};

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  waitingTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 20,
    textAlign: 'center',
  },
  waitingSubtitle: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  errorTitle: {
    color: '#ef4444',
    fontSize: 20,
    fontWeight: '700',
  },
  errorMessage: {
    color: '#d1d5db',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 24,
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  secondaryButton: {
    marginTop: 24,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  manageButton: {
    position: 'absolute',
    top: 18,
    left: 16,
    zIndex: 24,
    backgroundColor: 'rgba(99, 102, 241, 0.92)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  manageButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  managementModal: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '82%',
    backgroundColor: '#111827',
    borderRadius: 22,
    padding: 20,
  },
  managementTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  managementScroll: {
    flexGrow: 0,
  },
  managementScrollContent: {
    paddingBottom: 8,
  },
  sectionTitle: {
    color: '#93c5fd',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 8,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 10,
  },
  managementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  managementInfo: {
    flex: 1,
    marginRight: 8,
  },
  managementName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  managementMeta: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 4,
  },
  actionButton: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginLeft: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  admitButton: {
    backgroundColor: '#22c55e',
  },
  removeButton: {
    backgroundColor: '#ef4444',
  },
  hostBadge: {
    backgroundColor: '#374151',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  closeModalButton: {
    marginTop: 16,
    alignSelf: 'center',
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  closeModalButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default MeetingScreen;
