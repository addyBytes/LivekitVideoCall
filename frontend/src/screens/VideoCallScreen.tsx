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
  Animated,
  Easing,
  StatusBar,
  TouchableOpacity,
  AppState,
  AppStateStatus,
  NativeModules,
  Platform,
  useWindowDimensions,
} from 'react-native';
import {
  LiveKitRoom,
  useTracks,
  useRoomContext,
  useParticipants,
  AudioSession,
  isTrackReference,
} from '@livekit/react-native';
import {
  Track,
  Room,
  RoomEvent,
  ConnectionState as LiveKitConnectionState,
} from 'livekit-client';
import { Buffer } from 'buffer';
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
const PREVIEW_RATIO = 16 / 9;
const ROOM_PARTICIPANTS_POLL_INTERVAL = 2000;
const PipModule = NativeModules.PipModule as
  | {
      setInCallPipEnabled?: (enabled: boolean) => void;
      enterPictureInPicture?: () => void;
      supportsPip?: () => Promise<boolean>;
    }
  | undefined;

interface EmojiBurst {
  id: number;
  emoji: string;
  x: number;
  y: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
}

interface PipModeChangeEvent {
  isPip?: boolean;
}

// ============================================================
// Room Content (rendered inside LiveKitRoom)
// ============================================================
interface RoomContentProps {
  localParticipantId: string;
  roomName: string;
  onLeave: () => void;
  overlay?: React.ReactNode;
  hiddenParticipantIds?: string[];
}

export const VideoRoomContent: React.FC<RoomContentProps> = ({
  localParticipantId,
  roomName,
  onLeave,
  overlay,
  hiddenParticipantIds = [],
}) => {
  const room = useRoomContext();
  const participants = useParticipants();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isPip, setIsPip] = useState(false);
  const [isRoomConnected, setIsRoomConnected] = useState(
    room.state === LiveKitConnectionState.Connected,
  );
  const [activeRoomParticipantIds, setActiveRoomParticipantIds] = useState<
    string[] | null
  >(null);
  const pipRef = useRef(false);
  const justExitedPipRef = useRef(false);
  const [forceVideoOnly, setForceVideoOnly] = useState(false);
  const forceVideoOnlyRef = useRef(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [isLocalMain, setIsLocalMain] = useState(false);
  const [selectedRemoteId, setSelectedRemoteId] = useState<string | null>(null);
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null);
  const mediaEnabledRef = useRef(false);
  const [trackUpdate, setTrackUpdate] = useState(0);
  const [emojiBursts, setEmojiBursts] = useState<EmojiBurst[]>([]);
  const emojiBurstIdRef = useRef(0);
  const isTogglingScreenShareRef = useRef(false);
  const suppressAutoPipUntilRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const visibleParticipants = useMemo(
    () =>
      participants.filter(
        participant =>
          !hiddenParticipantIds.includes(participant.identity) &&
          (activeRoomParticipantIds == null ||
            activeRoomParticipantIds.includes(participant.identity)),
      ),
    [activeRoomParticipantIds, hiddenParticipantIds, participants],
  );

  useEffect(() => {
    let mounted = true;

    const loadActiveRoomParticipants = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/room-participants?roomName=${encodeURIComponent(
            roomName,
          )}`,
        );

        if (!response.ok) {
          return;
        }

        const data: { participantIds?: string[] } = await response.json();
        if (mounted) {
          setActiveRoomParticipantIds(data.participantIds || []);
        }
      } catch (error) {
        if (mounted) {
          setActiveRoomParticipantIds(null);
        }
      }
    };

    loadActiveRoomParticipants();
    const interval = setInterval(
      loadActiveRoomParticipants,
      ROOM_PARTICIPANTS_POLL_INTERVAL,
    );

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [roomName]);

  const triggerEmojiBurst = useCallback(
    (emoji: string) => {
      const id = emojiBurstIdRef.current++;
      const x = Math.max(
        30,
        Math.min(screenWidth - 180, screenWidth * (0.16 + Math.random() * 0.38)),
      );

      const burst: EmojiBurst = {
        id,
        emoji,
        x,
        y: new Animated.Value(0),
        opacity: new Animated.Value(1),
        scale: new Animated.Value(0.9),
      };

      setEmojiBursts(prev => [...prev, burst]);

      Animated.parallel([
        Animated.timing(burst.y, {
          toValue: -180,
          duration: 1200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(burst.opacity, {
          toValue: 0,
          duration: 1200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(burst.scale, {
          toValue: 1.25,
          duration: 1200,
          easing: Easing.out(Easing.back(1.3)),
          useNativeDriver: true,
        }),
      ]).start(() => {
        setEmojiBursts(prev => prev.filter(item => item.id !== id));
      });
    },
    [screenWidth],
  );

  // Explicitly enable camera and mic — only once on mount
  useEffect(() => {
    if (!isRoomConnected || mediaEnabledRef.current) return;
    mediaEnabledRef.current = true;
    const enableMedia = async () => {
      try {
        await room.localParticipant.setCameraEnabled(true, {
          resolution: {
            width: 640,
            height: 480,
          },
          frameRate: 30,
          facingMode: 'user',
        });
        await room.localParticipant.setMicrophoneEnabled(true);
        console.log('[Media] Camera and mic enabled');
      } catch (error) {
        console.error('[Media] Failed to enable camera/mic:', error);
      }
    };
    enableMedia();
  }, [isRoomConnected, room]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !PipModule) return;

    PipModule.setInCallPipEnabled?.(true);

    // Listen for PiP mode changes from native
    const emitter = require('react-native').NativeEventEmitter;
    const pipEmitter = new emitter(NativeModules.PipModule);
    const pipSub = pipEmitter.addListener('onPictureInPictureModeChanged', (event: PipModeChangeEvent) => {
      if (event && typeof event.isPip === 'boolean') {
        pipRef.current = event.isPip;
        setIsPip(event.isPip);
        if (event.isPip) {
          setForceVideoOnly(true);
          forceVideoOnlyRef.current = true;
        } else {
          // Restore UI immediately and synchronously
          setForceVideoOnly(false);
          forceVideoOnlyRef.current = false;
          // Allow AppState handler to run after a short delay
          justExitedPipRef.current = true;
          setTimeout(() => {
            justExitedPipRef.current = false;
          }, 700);
        }
      }
    });

    // Enter PiP from JS on background, hiding UI first
    const sub = AppState.addEventListener('change', nextState => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === 'active' && !pipRef.current) {
        setForceVideoOnly(false);
        forceVideoOnlyRef.current = false;
      }

      if (
        prev === 'active' &&
        (nextState === 'inactive' || nextState === 'background') &&
        !pipRef.current &&
        !forceVideoOnlyRef.current &&
        !justExitedPipRef.current &&
        !isTogglingScreenShareRef.current &&
        Date.now() > suppressAutoPipUntilRef.current
      ) {
        setForceVideoOnly(true);
        forceVideoOnlyRef.current = true;
        setTimeout(() => {
          PipModule.enterPictureInPicture?.();
        }, 100);
      }
    });

    return () => {
      PipModule.setInCallPipEnabled?.(false);
      pipSub.remove();
      sub.remove();
    };
  }, []);

  // Debug: Monitor room events for connectivity
  useEffect(() => {
    const onStateChange = (state: string) => {
      console.log(`[Room] Connection state changed: ${state}`);
      setIsRoomConnected(state === LiveKitConnectionState.Connected);
    };
    const onParticipantConnected = (p: any) => {
      console.log(`[Room] Remote participant connected: ${p.name || p.identity}`);
    };
    const onParticipantDisconnected = (p: any) => {
      console.log(`[Room] Remote participant disconnected: ${p.name || p.identity}`);
    };
    const onTrackSubscribed = (track: any, pub: any, participant: any) => {
      console.log(`[Room] Track subscribed: ${track.kind} from ${participant.name || participant.identity}`);
      setTrackUpdate(prev => prev + 1);
    };
    const onTrackUnsubscribed = (track: any, pub: any, participant: any) => {
      console.log(`[Room] Track unsubscribed: ${track.kind} from ${participant.name || participant.identity}`);
      setTrackUpdate(prev => prev + 1);
    };
    const onTrackSubscriptionStatusChanged = (pub: any, status: any, participant: any) => {
      console.log(`[Room] Track subscription status changed: ${pub.source} -> ${status} from ${participant.name || participant.identity}`);
      setTrackUpdate(prev => prev + 1);
    };
    const onTrackPublished = (pub: any, participant: any) => {
      console.log(`[Room] Track published: ${pub.source} from ${participant.name || participant.identity}`);
      setTrackUpdate(prev => prev + 1);
    };
    const onTrackUnpublished = (pub: any, participant: any) => {
      console.log(`[Room] Track unpublished: ${pub.source} from ${participant.name || participant.identity}`);
      setTrackUpdate(prev => prev + 1);
    };

    room.on(RoomEvent.ConnectionStateChanged, onStateChange);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.TrackSubscriptionStatusChanged, onTrackSubscriptionStatusChanged);
    room.on(RoomEvent.TrackPublished, onTrackPublished);
    room.on(RoomEvent.TrackUnpublished, onTrackUnpublished);
    // Listen for emoji reactions from other participants
    const onDataReceived = (payload: Uint8Array, participant: any) => {
      try {
        const str = Buffer.from(payload).toString('utf8');
        const data = JSON.parse(str);
        if (data.type === 'emoji' && typeof data.emoji === 'string') {
          triggerEmojiBurst(data.emoji);
        }
      } catch (err) {
        console.warn('Failed to parse received data message:', err);
      }
    };
    room.on(RoomEvent.DataReceived, onDataReceived);

    console.log(`[Room] Initial state: ${room.state}, Remote participants: ${room.remoteParticipants.size}`);

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onStateChange);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.TrackSubscriptionStatusChanged, onTrackSubscriptionStatusChanged);
      room.off(RoomEvent.TrackPublished, onTrackPublished);
      room.off(RoomEvent.TrackUnpublished, onTrackUnpublished);
      room.off(RoomEvent.DataReceived, onDataReceived);
    };
  }, [room, triggerEmojiBurst]);

  // Get camera + screen-share tracks
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const localIdentity = room.localParticipant?.identity || localParticipantId;

  const remoteParticipants = useMemo(
    () =>
      Array.from(room.remoteParticipants.values()).filter(
        participant => !hiddenParticipantIds.includes(participant.identity),
      ),
    [hiddenParticipantIds, room, trackUpdate],
  );

  useEffect(() => {
    if (remoteParticipants.length === 0) {
      setSelectedRemoteId(null);
      return;
    }

    const exists = remoteParticipants.some(p => p.identity === selectedRemoteId);
    if (!exists) {
      setSelectedRemoteId(remoteParticipants[0].identity);
    }
  }, [remoteParticipants, selectedRemoteId]);

  useEffect(() => {
    if (!pinnedParticipantId) {
      return;
    }

    const pinnedStillExists = visibleParticipants.some(
      participant => participant.identity === pinnedParticipantId,
    );

    if (!pinnedStillExists) {
      setPinnedParticipantId(null);
    }
  }, [visibleParticipants, pinnedParticipantId]);

  const localCameraTrackRef = useMemo(() => {
    const localTrack = tracks.find(
      item =>
        item.source === Track.Source.Camera &&
        item.participant.isLocal === true &&
        isTrackReference(item) &&
        item.publication?.track != null,
    );
    return localTrack;
  }, [tracks]);

  const localScreenShareTrackRef = useMemo(() => {
    const localTrack = tracks.find(
      item =>
        item.source === Track.Source.ScreenShare &&
        item.participant.isLocal === true &&
        isTrackReference(item) &&
        item.publication?.track != null,
    );
    return localTrack;
  }, [tracks]);

  const getRemoteCameraTrackRef = useCallback(
    (participantId: string) => {
      const remoteTrack = tracks.find(
        item =>
          item.source === Track.Source.Camera &&
          item.participant.isLocal !== true &&
          item.participant.identity === participantId &&
          isTrackReference(item) &&
          item.publication?.track != null,
      );
      return remoteTrack;
    },
    [tracks],
  );

  const getRemoteScreenShareTrackRef = useCallback(
    (participantId: string) => {
      const remoteTrack = tracks.find(
        item =>
          item.source === Track.Source.ScreenShare &&
          item.participant.isLocal !== true &&
          item.participant.identity === participantId &&
          isTrackReference(item) &&
          item.publication?.track != null,
      );
      return remoteTrack;
    },
    [tracks],
  );

  useEffect(() => {
    setIsScreenSharing(!!localScreenShareTrackRef);
  }, [localScreenShareTrackRef]);

  // Build participant info list
  const participantInfoList: ParticipantInfo[] = useMemo(() => {
    return visibleParticipants.map(p => ({
      id: p.identity,
      name: p.name || p.identity,
      joinedAt: new Date().toISOString(),
      isLocal: p.identity === localParticipantId,
      canPin: p.identity !== localParticipantId,
      isPinned: p.identity === pinnedParticipantId,
    }));
  }, [visibleParticipants, localParticipantId, pinnedParticipantId]);

  // Console log participant changes
  useEffect(() => {
    console.log(`\n[Room: ${roomName}] Participants: ${visibleParticipants.length}`);
    visibleParticipants.forEach(p => {
      console.log(`  - ${p.name || p.identity} (${p.identity})`);
    });
  }, [visibleParticipants, roomName]);

  const selectedRemoteParticipant = useMemo(() => {
    return (
      remoteParticipants.find(p => p.identity === selectedRemoteId) ??
      remoteParticipants[0]
    );
  }, [remoteParticipants, selectedRemoteId]);

  const pinnedParticipant = useMemo(
    () =>
      pinnedParticipantId
        ? visibleParticipants.find(
            participant => participant.identity === pinnedParticipantId,
          ) ?? null
          : null,
    [pinnedParticipantId, visibleParticipants],
  );

  const localParticipant = room.localParticipant;

  const isPinnedMode = !!pinnedParticipant;
  const isSingleParticipantLayout = visibleParticipants.length === 1;

  const isTwoParticipantLayout =
    visibleParticipants.length === 2 && remoteParticipants.length === 1;

  const mainParticipant =
    pinnedParticipant ??
    (isLocalMain || !selectedRemoteParticipant
      ? localParticipant
      : selectedRemoteParticipant);

  const previewParticipant =
    isPinnedMode
      ? null
      : mainParticipant?.identity === localIdentity
      ? selectedRemoteParticipant
      : localParticipant;

  const stageHeight = screenHeight;
  const previewWidth = Math.max(105, Math.min(140, Math.floor(screenWidth * 0.32)));
  const previewHeight = Math.round(previewWidth * PREVIEW_RATIO);
  const gridColumnCount = visibleParticipants.length >= 2 ? 2 : 1;
  const gridRowCount = Math.max(
    1,
    Math.ceil(visibleParticipants.length / gridColumnCount),
  );
  const gridGap = 8;
  const gridHorizontalPadding = 12;
  const gridVerticalPadding = 12;
  const controlsReservedHeight = 120;
  const availableGridWidth =
    screenWidth -
    gridHorizontalPadding * 2 -
    gridGap * (gridColumnCount - 1);
  const availableGridHeight = Math.max(
    220,
    stageHeight -
      controlsReservedHeight -
      gridVerticalPadding * 2 -
      gridGap * (gridRowCount - 1),
  );
  const gridTileWidth = Math.floor(availableGridWidth / gridColumnCount);
  const gridTileHeight = Math.floor(availableGridHeight / gridRowCount);

  const handleSwapMainPreview = useCallback(() => {
    if (!selectedRemoteParticipant) return;
    setIsLocalMain(prev => !prev);
  }, [selectedRemoteParticipant]);

  const handleToggleScreenShare = useCallback(async () => {
    if (isTogglingScreenShareRef.current) return;
    isTogglingScreenShareRef.current = true;
    suppressAutoPipUntilRef.current = Date.now() + 5000;
    try {
      const nextSharing = !isScreenSharing;
      await room.localParticipant.setScreenShareEnabled(nextSharing);
      setIsScreenSharing(nextSharing);
      console.log(`[ScreenShare] ${nextSharing ? 'Enabled' : 'Disabled'}`);
    } catch (error) {
      console.error('Failed to toggle screen sharing:', error);
    } finally {
      isTogglingScreenShareRef.current = false;
    }
  }, [room, isScreenSharing]);

  const handleSendReaction = useCallback(
    async (emoji: string) => {
      try {
        const msg = JSON.stringify({ type: 'emoji', emoji });
        const bytes = Uint8Array.from(Buffer.from(msg, 'utf8'));
        await room.localParticipant.publishData(bytes, { reliable: true });
      } catch (err) {
        console.warn('Failed to send emoji reaction:', err);
      }
      triggerEmojiBurst(emoji);
    },
    [room, triggerEmojiBurst],
  );

  const handlePinParticipant = useCallback((participantIdentity: string) => {
    setPinnedParticipantId(participantIdentity);
    setShowParticipants(false);
  }, []);

  const handleUnpinParticipant = useCallback(() => {
    setPinnedParticipantId(null);
  }, []);

  const getTrackRefForParticipant = useCallback(
    (participantIdentity: string) => {
      if (participantIdentity === localIdentity) {
        return localScreenShareTrackRef ?? localCameraTrackRef;
      }

      return (
        getRemoteScreenShareTrackRef(participantIdentity) ??
        getRemoteCameraTrackRef(participantIdentity)
      );
    },
    [
      localIdentity,
      localScreenShareTrackRef,
      localCameraTrackRef,
      getRemoteScreenShareTrackRef,
      getRemoteCameraTrackRef,
    ],
  );

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
      const nextEnabled = !isCameraEnabled;
      if (nextEnabled) {
        // Re-enable with the currently selected camera side.
        await room.localParticipant.setCameraEnabled(true, {
          resolution: {
            width: 640,
            height: 480,
          },
          frameRate: 30,
          facingMode: isFrontCamera ? 'user' : 'environment',
        });
      } else {
        await room.localParticipant.setCameraEnabled(false);
      }

      setIsCameraEnabled(nextEnabled);
      console.log(`[Camera] ${nextEnabled ? 'Enabled' : 'Disabled'}`);
    } catch (error) {
      console.error('Failed to toggle camera:', error);
    }
  }, [room, isCameraEnabled, isFrontCamera]);

  // Switch front/back camera while keeping current enabled state
  const handleSwitchCamera = useCallback(async () => {
    if (!isCameraEnabled) return;

    try {
      const nextIsFront = !isFrontCamera;
      const nextFacingMode = nextIsFront ? 'user' : 'environment';

      // Get currently published local camera track.
      const cameraPublication = room.localParticipant.getTrackPublication(
        Track.Source.Camera,
      );
      const localVideoTrack = cameraPublication?.videoTrack;

      if (!localVideoTrack) {
        // If no track exists (edge case), publish camera with target facing mode.
        await room.localParticipant.setCameraEnabled(true, {
          resolution: {
            width: 640,
            height: 480,
          },
          frameRate: 30,
          facingMode: nextFacingMode,
        });
      } else {
        const mediaTrack = localVideoTrack.mediaStreamTrack as any;
        const settings = mediaTrack?.getSettings?.() ?? {};
        const currentDeviceId = settings.deviceId as string | undefined;

        // Primary path: switch by explicit deviceId for better cross-device behavior.
        const videoDevices = await Room.getLocalDevices('videoinput', true);
        if (videoDevices.length >= 2) {
          const frontRegex = /(front|user|selfie)/i;
          const backRegex = /(back|rear|environment)/i;
          const targetRegex = nextIsFront ? frontRegex : backRegex;

          let targetDevice =
            videoDevices.find(
              d => d.deviceId !== currentDeviceId && targetRegex.test(d.label || ''),
            ) ??
            videoDevices.find(d => d.deviceId !== currentDeviceId);

          if (!targetDevice && currentDeviceId) {
            const currentIdx = videoDevices.findIndex(d => d.deviceId === currentDeviceId);
            if (currentIdx >= 0) {
              targetDevice = videoDevices[(currentIdx + 1) % videoDevices.length];
            }
          }

          if (targetDevice && targetDevice.deviceId !== currentDeviceId) {
            const switched = await localVideoTrack.setDeviceId(targetDevice.deviceId);
            if (switched) {
              setIsFrontCamera(nextIsFront);
              console.log(`[Camera] Switched to ${nextIsFront ? 'front' : 'back'} camera via deviceId`);
              return;
            }
          }
        }

        // Primary path: force camera re-acquire with the new facing mode.
        // This is the most reliable approach on React Native devices.
        try {
          await localVideoTrack.restartTrack({
            resolution: {
              width: 640,
              height: 480,
            },
            frameRate: 30,
            facingMode: nextFacingMode,
          });
        } catch (restartError) {
          // Fallback path for devices where restartTrack isn't available/reliable.
          if (typeof mediaTrack?._switchCamera === 'function') {
            mediaTrack._switchCamera();
          } else if (typeof mediaTrack?.applyConstraints === 'function') {
            await mediaTrack.applyConstraints({
              facingMode: nextFacingMode,
            });
          } else {
            // Hard fallback: force camera republish with new facing mode.
            await room.localParticipant.setCameraEnabled(false);
            await room.localParticipant.setCameraEnabled(true, {
              resolution: {
                width: 640,
                height: 480,
              },
              frameRate: 30,
              facingMode: nextFacingMode,
            });
            if (restartError instanceof Error) {
              console.warn('[Camera] restartTrack failed, used republish fallback:', restartError.message);
            }
          }
        }
      }

      setIsFrontCamera(nextIsFront);
      console.log(`[Camera] Switched to ${nextIsFront ? 'front' : 'back'} camera`);
    } catch (error) {
      console.error('Failed to switch camera:', error);
    }
  }, [room, isCameraEnabled, isFrontCamera]);

  // Leave room
  const handleLeaveRoom = useCallback(async () => {
    try {
      console.log(`\n========================`);
      console.log(`  LEFT ROOM ${roomName}`);
      console.log(`========================\n`);

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
        // Backend notification is best-effort.
      }

      await room.disconnect();
    } catch (error) {
      console.error('Error while leaving room:', error);
    } finally {
      onLeave();
    }
  }, [room, roomName, localParticipantId, onLeave]);

  if (isPip || forceVideoOnly) {
    // Only show main video in PiP mode or when forceVideoOnly is set (no preview, no overlays, no ControlsBar)
    return (
      <View style={styles.roomContainer}>
        <View style={[styles.videoGrid, { height: stageHeight }]}> 
          {visibleParticipants.length > 0 ? (
            <View style={styles.videoStage}>
              <VideoTile
                key={`main-${mainParticipant.identity}-${trackUpdate}`}
                trackRef={getTrackRefForParticipant(mainParticipant.identity)}
                participantName={mainParticipant.name || mainParticipant.identity}
                participantId={mainParticipant.identity}
                isSpeaking={false}
                isLocal={mainParticipant.identity === localIdentity}
                isPreview={false}
                tileWidth={screenWidth}
                tileHeight={stageHeight}
              />
            </View>
          ) : (
            <View style={styles.noVideoContainer}>
              <Text style={styles.noVideoText}>Waiting for participants...</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // Normal mode: show all controls
  return (
    <View style={styles.roomContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a1a" />
      {overlay}
      <View style={styles.roomHeader}>
        <Text style={styles.roomTitle}>{roomName}</Text>
        <Text style={styles.roomSubtitle}>{visibleParticipants.length} participant(s)</Text>
      </View>
      {pinnedParticipant ? (
        <View style={styles.pinnedBanner}>
          <Text style={styles.pinnedBannerText}>
            Pinned: {pinnedParticipant.name || pinnedParticipant.identity}
          </Text>
          <TouchableOpacity
            style={styles.unpinButton}
            onPress={handleUnpinParticipant}
            activeOpacity={0.85}
          >
            <Text style={styles.unpinButtonText}>Unpin</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={[styles.videoGrid, { height: stageHeight }]}> 
        {visibleParticipants.length > 0 ? (
          isPinnedMode && mainParticipant ? (
            <View style={styles.videoStage}>
              <VideoTile
                key={`pinned-${mainParticipant.identity}-${trackUpdate}`}
                trackRef={getTrackRefForParticipant(mainParticipant.identity)}
                participantName={mainParticipant.name || mainParticipant.identity}
                participantId={mainParticipant.identity}
                isSpeaking={!!mainParticipant.isSpeaking}
                isLocal={mainParticipant.identity === localIdentity}
                isPreview={false}
                tileWidth={screenWidth}
                tileHeight={stageHeight}
              />
            </View>
          ) : isSingleParticipantLayout && mainParticipant ? (
            <View style={styles.videoStage}>
              <VideoTile
                key={`solo-${mainParticipant.identity}-${trackUpdate}`}
                trackRef={getTrackRefForParticipant(mainParticipant.identity)}
                participantName={mainParticipant.name || mainParticipant.identity}
                participantId={mainParticipant.identity}
                isSpeaking={!!mainParticipant.isSpeaking}
                isLocal={mainParticipant.identity === localIdentity}
                isPreview={false}
                tileWidth={screenWidth}
                tileHeight={stageHeight}
              />
            </View>
          ) : isTwoParticipantLayout && mainParticipant ? (
            <View style={styles.videoStage}>
              <VideoTile
                key={`main-${mainParticipant.identity}-${trackUpdate}`}
                trackRef={getTrackRefForParticipant(mainParticipant.identity)}
                participantName={mainParticipant.name || mainParticipant.identity}
                participantId={mainParticipant.identity}
                isSpeaking={!!mainParticipant.isSpeaking}
                isLocal={mainParticipant.identity === localIdentity}
                isPreview={false}
                tileWidth={screenWidth}
                tileHeight={stageHeight}
              />
              {previewParticipant ? (
                <TouchableOpacity
                  style={[
                    styles.previewTouchable,
                    { width: previewWidth, height: previewHeight },
                  ]}
                  activeOpacity={0.9}
                  onPress={handleSwapMainPreview}
                >
                  <VideoTile
                    key={`preview-${previewParticipant.identity}-${trackUpdate}`}
                    trackRef={getTrackRefForParticipant(previewParticipant.identity)}
                    participantName={previewParticipant.name || previewParticipant.identity}
                    participantId={previewParticipant.identity}
                    isSpeaking={!!previewParticipant.isSpeaking}
                    isLocal={previewParticipant.identity === localIdentity}
                    isPreview={true}
                    tileWidth={previewWidth}
                    tileHeight={previewHeight}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <View style={styles.gridWrap}>
              {visibleParticipants.map(p => (
                <VideoTile
                  key={`grid-${p.identity}-${trackUpdate}`}
                  trackRef={getTrackRefForParticipant(p.identity)}
                  participantName={p.name || p.identity}
                  participantId={p.identity}
                  isSpeaking={!!p.isSpeaking}
                  isLocal={p.identity === localIdentity}
                  isPreview={false}
                  tileWidth={gridTileWidth}
                  tileHeight={gridTileHeight}
                />
              ))}
            </View>
          )
        ) : (
          <View style={styles.noVideoContainer}>
            <Text style={styles.noVideoText}>Waiting for participants...</Text>
          </View>
        )}
        {/* Only render emoji bursts if not in PiP mode */}
        {!isPip && emojiBursts.map(burst => (
          <Animated.Text
            key={burst.id}
            style={[
              styles.reactionBurst,
              {
                left: burst.x,
                opacity: burst.opacity,
                transform: [{ translateY: burst.y }, { scale: burst.scale }],
              },
            ]}
          >
            {burst.emoji}
          </Animated.Text>
        ))}
      </View>
      {/* Only render ControlsBar and ParticipantList if not in PiP mode */}
      {!isPip && (
        <>
          <ControlsBar
            isMicEnabled={isMicEnabled}
            isCameraEnabled={isCameraEnabled}
            isFrontCamera={isFrontCamera}
            isScreenSharing={isScreenSharing}
            isSwitchCameraDisabled={isScreenSharing}
            onToggleMic={handleToggleMic}
            onToggleCamera={handleToggleCamera}
            onSwitchCamera={handleSwitchCamera}
            onToggleScreenShare={handleToggleScreenShare}
            onSendReaction={handleSendReaction}
            onLeaveRoom={handleLeaveRoom}
            onToggleParticipants={() => setShowParticipants(!showParticipants)}
            participantCount={visibleParticipants.length}
          />
          <ParticipantList
            participants={participantInfoList}
            visible={showParticipants}
            onClose={() => setShowParticipants(false)}
            onPinParticipant={handlePinParticipant}
          />
        </>
      )}
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
  const [audioReady, setAudioReady] = useState(false);

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

  // Configure audio session for React Native — MUST complete before LiveKitRoom connects
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
        console.warn('Failed to stop audio session:', error);
      });
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

  // Connected - render LiveKit room (only after audio session is ready)
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
        audio={false}
        video={false}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onError={handleError}
      >
        <VideoRoomContent
          localParticipantId={participantId}
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
    paddingHorizontal: 12,
    paddingVertical: 2, // reduce vertical padding to minimize top space
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
    padding: 0,
    marginTop: 0, // ensure no extra margin
  },
  videoStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewTouchable: {
    position: 'absolute',
    bottom: 95, // lift it above the button bar
    right: 16,
    borderRadius: 16, // curve all sides more
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    zIndex: 10,
  },
  reactionBurst: {
    position: 'absolute',
    bottom: 120,
    fontSize: 34,
    zIndex: 30,
  },
  pinnedBanner: {
    position: 'absolute',
    top: 44,
    alignSelf: 'center',
    zIndex: 26,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12, 12, 28, 0.94)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  pinnedBannerText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  unpinButton: {
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  unpinButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  gridWrap: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 8,
    paddingTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'flex-start',
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
