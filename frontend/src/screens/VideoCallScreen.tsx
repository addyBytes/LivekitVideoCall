// ============================================================
// VideoCallScreen
// Main screen that connects to LiveKit and renders the call UI
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
  Dimensions,
  ScrollView,
  StatusBar,
  TouchableOpacity,
} from 'react-native';
import {
  LiveKitRoom,
  useTracks,
  useRoomContext,
  useParticipants,
  AudioSession,
  isTrackReference,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import { API_BASE_URL } from '../config/api';
import VideoTile from '../components/VideoTile';
import ParticipantList from '../components/ParticipantList';
import ControlsBar from '../components/ControlsBar';
import type {
  VideoCallScreenProps,
  ParticipantInfo,
  ConnectionState,
  CreateTokenResponse,
} from '../types';

// ============================================================
// Constants
// ============================================================
const TILES_PER_PAGE = 4;
// 9:16 portrait ratio — height = width * (16/9)
const PORTRAIT_RATIO = 16 / 9;

// ============================================================
// Tile size calculator — always 9:16 portrait ratio
// ============================================================
const getTileSizes = (screenWidth: number, screenHeight: number) => {
  const availableWidth = screenWidth - 8; // 4px padding each side
  const availableHeight = screenHeight - 160; // header + controls

  // Two-column tile (used in 2×2 grid and 2-per-row layouts)
  const twoColWidth = Math.floor(availableWidth / 2) - 4;
  const twoColHeight = Math.round(twoColWidth * PORTRAIT_RATIO);

  // Single / full-width tile — fit inside available area maintaining 9:16
  const fullByHeight = Math.floor(availableHeight / PORTRAIT_RATIO);
  const singleWidth = Math.min(availableWidth, fullByHeight);
  const singleHeight = Math.round(singleWidth * PORTRAIT_RATIO);

  return {
    twoColWidth,
    twoColHeight,
    singleWidth,
    singleHeight,
    availableWidth,
    availableHeight,
  };
};

// ============================================================
// Room Content (rendered inside LiveKitRoom)
// ============================================================
interface RoomContentProps {
  localParticipantId: string;
  localParticipantName: string;
  roomName: string;
  onLeave: () => void;
}

const RoomContent: React.FC<RoomContentProps> = ({
  localParticipantId,
  localParticipantName,
  roomName,
  onLeave,
}) => {
  const room = useRoomContext();
  const participants = useParticipants();
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [showParticipants, setShowParticipants] = useState(false);
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));
  const [currentPage, setCurrentPage] = useState(0);
  const pageScrollRef = useRef<ScrollView>(null);
  const mediaEnabledRef = useRef(false);

  // Listen for dimension changes (rotation)
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions(window);
    });
    return () => subscription.remove();
  }, []);

  // Explicitly enable camera and mic — only once on mount
  useEffect(() => {
    if (mediaEnabledRef.current) return;
    mediaEnabledRef.current = true;
    const enableMedia = async () => {
      try {
        await room.localParticipant.setCameraEnabled(true , {
        resolution: {
          width: 640,
          height: 480,
        },
        frameRate: 30,
        
      });
        await room.localParticipant.setMicrophoneEnabled(true);
        console.log('[Media] Camera and mic enabled');
      } catch (error) {
        console.error('[Media] Failed to enable camera/mic:', error);
      }
    };
    enableMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get all video tracks
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: true },
  );

  // Filter to video tracks only
  const videoTracks = useMemo(() => {
    return tracks.filter(
      trackRef =>
        trackRef.source === Track.Source.Camera ||
        trackRef.source === Track.Source.ScreenShare,
    );
  }, [tracks]);

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
    console.log(`\n[Room: ${roomName}] Participants: ${participants.length}`);
    participants.forEach(p => {
      console.log(`  - ${p.name || p.identity} (${p.identity})`);
    });
  }, [participants, roomName]);

  // Tile sizes — always 9:16
  const tileSizes = useMemo(
    () => getTileSizes(dimensions.width, dimensions.height),
    [dimensions],
  );

  // Split tracks into pages of 4
  const pages = useMemo(() => {
    if (videoTracks.length === 0) return [];
    const result: (typeof videoTracks)[] = [];
    for (let i = 0; i < videoTracks.length; i += TILES_PER_PAGE) {
      result.push(videoTracks.slice(i, i + TILES_PER_PAGE));
    }
    return result;
  }, [videoTracks]);

  const totalPages = pages.length;

  // Keep currentPage in bounds if participants leave
  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      const newPage = totalPages - 1;
      setCurrentPage(newPage);
      pageScrollRef.current?.scrollTo({
        x: newPage * dimensions.width,
        animated: false,
      });
    }
  }, [totalPages, currentPage, dimensions.width]);

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

  // Toggle camera
  const handleToggleCamera = useCallback(async () => {
    try {
      await room.localParticipant.setCameraEnabled(!isCameraEnabled);
      setIsCameraEnabled(!isCameraEnabled);
      console.log(`[Camera] ${!isCameraEnabled ? 'Enabled' : 'Disabled'}`);
    } catch (error) {
      console.error('Failed to toggle camera:', error);
    }
  }, [room, isCameraEnabled]);

  // Leave room
  const handleLeaveRoom = useCallback(async () => {
    try {
      console.log(`\n========================`);
      console.log(`  LEFT ROOM ${roomName}`);
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

  // Render a single video tile with correct size based on page slot count
  const renderTile = useCallback(
    (item: (typeof videoTracks)[0], slotCount: number) => {
      const participant = item.participant;
      const isLocal = participant.identity === localParticipantId;
      const isSpeaking = participant.isSpeaking;
      const useSingle = slotCount === 1;
      const tileWidth = useSingle
        ? tileSizes.singleWidth
        : tileSizes.twoColWidth;
      const tileHeight = useSingle
        ? tileSizes.singleHeight
        : tileSizes.twoColHeight;

      return (
        <VideoTile
          key={`${participant.identity}-${item.source}`}
          trackRef={isTrackReference(item) ? item : undefined}
          participantName={participant.name || participant.identity}
          participantId={participant.identity}
          isSpeaking={isSpeaking}
          isLocal={isLocal}
          tileWidth={tileWidth}
          tileHeight={tileHeight}
        />
      );
    },
    [localParticipantId, tileSizes],
  );

  // Render one page (up to 4 tiles in a 2×2 grid)
  const renderPage = useCallback(
    (pageTracks: typeof videoTracks, pageIndex: number) => {
      const count = pageTracks.length;

      // 1 tile — centered
      if (count === 1) {
        return (
          <View
            key={pageIndex}
            style={[styles.page, { width: dimensions.width }]}
          >
            <View style={styles.singleTileWrapper}>
              {renderTile(pageTracks[0], 1)}
            </View>
          </View>
        );
      }

      // 2 tiles — side by side
      if (count === 2) {
        return (
          <View
            key={pageIndex}
            style={[styles.page, { width: dimensions.width }]}
          >
            <View style={styles.row}>
              {renderTile(pageTracks[0], 2)}
              {renderTile(pageTracks[1], 2)}
            </View>
          </View>
        );
      }

      // 3 tiles — 2 on top, 1 centered below
      if (count === 3) {
        return (
          <View
            key={pageIndex}
            style={[styles.page, { width: dimensions.width }]}
          >
            <View style={styles.row}>
              {renderTile(pageTracks[0], 2)}
              {renderTile(pageTracks[1], 2)}
            </View>
            <View style={styles.row}>{renderTile(pageTracks[2], 2)}</View>
          </View>
        );
      }

      // 4 tiles — 2×2 grid
      return (
        <View
          key={pageIndex}
          style={[styles.page, { width: dimensions.width }]}
        >
          <View style={styles.row}>
            {renderTile(pageTracks[0], 2)}
            {renderTile(pageTracks[1], 2)}
          </View>
          <View style={styles.row}>
            {renderTile(pageTracks[2], 2)}
            {renderTile(pageTracks[3], 2)}
          </View>
        </View>
      );
    },
    [dimensions.width, renderTile],
  );

  return (
    <View style={styles.roomContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />

      {/* Room Header */}
      <View style={styles.roomHeader}>
        <Text style={styles.roomTitle}>{roomName}</Text>
        <Text style={styles.roomSubtitle}>
          {participants.length} participant
          {participants.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Paginated Video Grid */}
      <View style={styles.videoGrid}>
        {pages.length === 0 ? (
          <View style={styles.noVideoContainer}>
            <Text style={styles.noVideoText}>Waiting for participants...</Text>
          </View>
        ) : (
          <ScrollView
            ref={pageScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={e => {
              const newPage = Math.round(
                e.nativeEvent.contentOffset.x / dimensions.width,
              );
              setCurrentPage(newPage);
            }}
            style={{ flex: 1 }}
          >
            {pages.map((pageTracks, idx) => renderPage(pageTracks, idx))}
          </ScrollView>
        )}
      </View>

      {/* Page Indicators */}
      {totalPages > 1 && (
        <View style={styles.pageIndicatorRow}>
          {pages.map((_, idx) => (
            <TouchableOpacity
              key={idx}
              style={[
                styles.pageDot,
                idx === currentPage && styles.pageDotActive,
              ]}
              onPress={() => {
                setCurrentPage(idx);
                pageScrollRef.current?.scrollTo({
                  x: idx * dimensions.width,
                  animated: true,
                });
              }}
            />
          ))}
        </View>
      )}

      {/* Controls Bar */}
      <ControlsBar
        isMicEnabled={isMicEnabled}
        isCameraEnabled={isCameraEnabled}
        onToggleMic={handleToggleMic}
        onToggleCamera={handleToggleCamera}
        onLeaveRoom={handleLeaveRoom}
        onToggleParticipants={() => setShowParticipants(!showParticipants)}
        participantCount={participants.length}
      />

      {/* Participant List Modal */}
      <ParticipantList
        participants={participantInfoList}
        visible={showParticipants}
        onClose={() => setShowParticipants(false)}
      />
    </View>
  );
};

// ============================================================
// VideoCallScreen (Main Exported Component)
// ============================================================
const VideoCallScreen: React.FC<VideoCallScreenProps> = ({
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

  // Fetch token from backend
  useEffect(() => {
    const fetchToken = async () => {
      setConnectionState('connecting');
      try {
        console.log(
          `\n[Connecting] Room: ${roomName}, User: ${participantName}`,
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
        // Token fetched successfully - LiveKitRoom will now render and handle connection
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

  // Configure audio session for React Native
  useEffect(() => {
    const configureAudio = async () => {
      try {
        await AudioSession.startAudioSession();
      } catch (error) {
        console.error('Failed to start audio session:', error);
      }
    };

    configureAudio();

    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  // Handle connection events
  const handleConnected = useCallback(() => {
    setConnectionState('connected');
    console.log(`\n========================`);
    console.log(`  CONNECTED TO ROOM`);
    console.log(`  Room: ${roomName}`);
    console.log(`========================\n`);
  }, [roomName]);

  const handleDisconnected = useCallback(() => {
    setConnectionState('disconnected');
    console.log(`[Disconnected] Room: ${roomName}`);
  }, [roomName]);

  const handleError = useCallback((error: any) => {
    console.error('[Room Error]', error);
    setConnectionState('error');
    setErrorMessage(error?.message || 'Connection error');
  }, []);

  // Loading state — only show while fetching token
  if (connectionState === 'connecting') {
    return (
      <View style={styles.centerContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Connecting to room...</Text>
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

  // Connected - render LiveKit room
  if (token && livekitUrl) {
    return (
      <LiveKitRoom
        serverUrl={livekitUrl}
        token={token}
        connect={true}
        options={{
          adaptiveStream: true,
          dynacast: false,
          
        }}
        audio={true}
        video={true}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onError={handleError}
      >
        <RoomContent
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

// ============================================================
// Styles
// ============================================================
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
  videoGrid: {
    flex: 1,
    padding: 4,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
    marginVertical: 2,
  },
  singleTileWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageIndicatorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  pageDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  pageDotActive: {
    width: 20,
    backgroundColor: '#6366f1',
  },
  noVideoContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noVideoText: {
    color: '#6b7280',
    fontSize: 16,
  },
});

export default VideoCallScreen;
