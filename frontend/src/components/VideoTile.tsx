// ============================================================
// VideoTile Component
// Renders a single participant's video with overlay info
// ============================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { VideoTrack } from '@livekit/react-native';
import type { VideoTileProps } from '../types';

const getInitials = (name: string) =>
  name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);

const VideoTile: React.FC<VideoTileProps & { trackUpdate?: number }> = ({
  trackRef,
  participantName,
  participantId,
  isSpeaking,
  isLocal,
  isPreview = false,
  tileWidth,
  tileHeight,
}) => {
  return (
    <View
      style={[
        styles.container,
        {
          width: tileWidth,
          height: tileHeight,
        },
        isPreview && styles.previewContainer,
        isSpeaking && styles.speaking,
      ]}
    >
      {/* Video View or Avatar Fallback */}
      {trackRef ? (
        <VideoTrack
          style={styles.videoView}
          trackRef={trackRef}
          objectFit="cover"
          mirror={isLocal}
          zOrder={isPreview ? 1 : 0}
        />
      ) : (
        <View style={styles.avatarContainer}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {getInitials(participantName || participantId)}
            </Text>
          </View>
          <Text style={styles.avatarName} numberOfLines={1}>
            {participantName || participantId}
          </Text>
          <Text style={styles.cameraOffText}>Camera off</Text>
        </View>
      )}

      {/* Overlay: Participant Info */}
      <View style={styles.overlay}>
        {/* Speaking Indicator */}
        {isSpeaking && (
          <View style={styles.speakingBadge}>
            <Text style={styles.speakingText}>🔊</Text>
          </View>
        )}

        {/* Local Badge */}
        {isLocal && (
          <View style={styles.localBadge}>
            <Text style={styles.localText}>You</Text>
          </View>
        )}

        {/* Bottom Info Bar */}
        <View style={styles.infoBar}>
          <Text style={styles.nameText} numberOfLines={1}>
            {participantName}
          </Text>
          <Text style={styles.uuidText} numberOfLines={1}>
            {participantId.substring(0, 8)}...
          </Text>
        </View>
      </View>

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 2,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a2e',
    position: 'relative',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  previewContainer: {
    borderWidth: 0,
    margin: 0,
    borderRadius: 8,
    overflow: 'hidden',
  },
  speaking: {
    borderColor: '#00d4aa',
  },
  videoView: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  avatarContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
  },
  avatarName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '80%',
  },
  cameraOffText: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 4,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: 8,
  },
  speakingBadge: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(0, 212, 170, 0.8)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  speakingText: {
    fontSize: 14,
  },
  localBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.9)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  localText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  infoBar: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    maxWidth: '80%',
  },
  nameText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  uuidText: {
    color: '#a0a0b0',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
});

export default VideoTile;
