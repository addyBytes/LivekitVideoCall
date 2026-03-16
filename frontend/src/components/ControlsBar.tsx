// ============================================================
// ControlsBar Component
// Bottom bar with mic, camera, leave, and participant toggle
// ============================================================

import React, {useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import type {ControlsBarProps} from '../types';

const REACTIONS = ['❤️', '😂', '👍', '🔥', '👏'];

const ControlsBar: React.FC<ControlsBarProps> = ({
  isMicEnabled,
  isCameraEnabled,
  isFrontCamera,
  isScreenSharing,
  isSwitchCameraDisabled = false,
  onToggleMic,
  onToggleCamera,
  onSwitchCamera,
  onToggleScreenShare,
  onSendReaction,
  onLeaveRoom,
  onToggleParticipants,
  participantCount,
}) => {
  const [showReactions, setShowReactions] = useState(false);

  const handleReactionPress = (emoji: string) => {
    onSendReaction(emoji);
    setShowReactions(false);
  };

  return (
    <View style={styles.container}>
      {showReactions && (
        <View style={styles.reactionPanel}>
          {REACTIONS.map(emoji => (
            <TouchableOpacity
              key={emoji}
              style={styles.reactionButton}
              onPress={() => handleReactionPress(emoji)}
              activeOpacity={0.8}>
              <Text style={styles.reactionEmoji}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Mic Toggle */}
      <TouchableOpacity
        style={[styles.button, !isMicEnabled && styles.buttonDisabled]}
        onPress={onToggleMic}
        activeOpacity={0.7}>
        <Text style={styles.buttonIcon}>{isMicEnabled ? '🎙️' : '🔇'}</Text>
        <Text style={styles.buttonLabel}>
          {isMicEnabled ? 'Mute' : 'Unmute'}
        </Text>
      </TouchableOpacity>

      {/* Camera Toggle */}
      <TouchableOpacity
        style={[styles.button, !isCameraEnabled && styles.buttonDisabled]}
        onPress={onToggleCamera}
        activeOpacity={0.7}>
        <Text style={styles.buttonIcon}>
          {isCameraEnabled ? '📹' : '📷'}
        </Text>
        <Text style={styles.buttonLabel}>
          {isCameraEnabled ? 'Cam Off' : 'Cam On'}
        </Text>
      </TouchableOpacity>

      {/* Camera Switch */}
      <TouchableOpacity
        style={[
          styles.button,
          (isSwitchCameraDisabled || !isCameraEnabled) && styles.buttonDisabled,
        ]}
        onPress={onSwitchCamera}
        activeOpacity={0.7}
        disabled={isSwitchCameraDisabled || !isCameraEnabled}>
        <Text style={styles.buttonIcon}>🔄</Text>
        <Text style={styles.buttonLabel}>
          {isFrontCamera ? 'Front' : 'Back'}
        </Text>
      </TouchableOpacity>

      {/* Screen Share */}
      <TouchableOpacity
        style={[styles.button, isScreenSharing && styles.shareActiveButton]}
        onPress={onToggleScreenShare}
        activeOpacity={0.7}>
        <Text style={styles.buttonIcon}>{isScreenSharing ? '🛑' : '🖥️'}</Text>
        <Text style={styles.buttonLabel}>
          {isScreenSharing ? 'Stop Share' : 'Share'}
        </Text>
      </TouchableOpacity>

      {/* Reactions */}
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowReactions(prev => !prev)}
        activeOpacity={0.7}>
        <Text style={styles.buttonIcon}>😊</Text>
        <Text style={styles.buttonLabel}>React</Text>
      </TouchableOpacity>

      {/* Participants Toggle */}
      <TouchableOpacity
        style={styles.button}
        onPress={onToggleParticipants}
        activeOpacity={0.7}>
        <View style={styles.participantIconContainer}>
          <Text style={styles.buttonIcon}>👥</Text>
          {participantCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{participantCount}</Text>
            </View>
          )}
        </View>
        <Text style={styles.buttonLabel}>People</Text>
      </TouchableOpacity>

      {/* Leave Room */}
      <TouchableOpacity
        style={[styles.button, styles.leaveButton]}
        onPress={onLeaveRoom}
        activeOpacity={0.7}>
        <Text style={styles.buttonIcon}>📞</Text>
        <Text style={[styles.buttonLabel, styles.leaveLabel]}>Leave</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f0f23',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 40,
  },
  reactionPanel: {
    position: 'absolute',
    bottom: 92,
    left: 12,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(12, 12, 28, 0.95)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  reactionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  reactionEmoji: {
    fontSize: 20,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    minWidth: 58,
  },
  buttonDisabled: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  buttonIcon: {
    fontSize: 22,
  },
  buttonLabel: {
    color: '#d1d5db',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  participantIconContainer: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: '#6366f1',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
  },
  leaveButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
  },
  shareActiveButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
  },
  leaveLabel: {
    color: '#ffffff',
  },
});

export default React.memo(ControlsBar);
