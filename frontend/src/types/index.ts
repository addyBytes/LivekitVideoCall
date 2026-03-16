// ============================================================
// TypeScript Types for Video Call App
// ============================================================

/**
 * Response from the backend /create-token endpoint
 */
export interface CreateTokenResponse {
  token: string;
  livekitUrl: string;
  participantId: string;
}

/**
 * Request body for /create-token endpoint
 */
export interface CreateTokenRequest {
  roomName: string;
  participantName: string;
}

/**
 * Participant info tracked locally on the frontend
 */
export interface ParticipantInfo {
  id: string;
  name: string;
  joinedAt: string;
  isLocal: boolean;
}

/**
 * Connection state for the video call
 */
export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'error';

/**
 * Props for the VideoCallScreen
 */
export interface VideoCallScreenProps {
  roomName: string;
  participantName: string;
  onLeave: () => void;
}

/**
 * Props for the VideoTile component
 */
export interface VideoTileProps {
  trackRef: any;
  participantName: string;
  participantId: string;
  isSpeaking: boolean;
  isLocal: boolean;
  isPreview?: boolean;
  tileWidth: number;
  tileHeight: number;
}

/**
 * Props for the ParticipantList component
 */
export interface ParticipantListProps {
  participants: ParticipantInfo[];
  visible: boolean;
  onClose: () => void;
}

/**
 * Call type - audio only or video
 */
export type CallType = 'audio' | 'video';

/**
 * Props for the ControlsBar component
 */
export interface ControlsBarProps {
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isFrontCamera: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onLeaveRoom: () => void;
  onToggleParticipants: () => void;
  participantCount: number;
}

/**
 * Props for the AudioCallScreen
 */
export interface AudioCallScreenProps {
  roomName: string;
  participantName: string;
  onLeave: () => void;
}
