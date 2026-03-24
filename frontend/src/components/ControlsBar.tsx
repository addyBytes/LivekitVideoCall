// ============================================================
// ControlsBar Component
// Bottom bar with mic, camera, leave, and participant toggle
// ============================================================

import React, {useState} from 'react';
import { Platform, NativeModules } from 'react-native';

interface PipModeChangeEvent {
  isPip?: boolean;
}

// PiP mode detection helper (must match VideoCallScreen)
function usePipMode() {
  const [isPip, setIsPip] = useState(false);
  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = (event: PipModeChangeEvent) => {
      if (event && typeof event.isPip === 'boolean') setIsPip(event.isPip);
    };
    const emitter = require('react-native').NativeEventEmitter;
    const pipEmitter = new emitter(NativeModules.PipModule);
    const sub = pipEmitter.addListener('onPictureInPictureModeChanged', handler);
    return () => sub.remove();
  }, []);
  return isPip;
}
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
  const isPipMode = usePipMode();

  if (isPipMode) return null;

  const handleReactionPress = (emoji: string) => {
    onSendReaction(emoji);
    setShowReactions(false);
  };

  return (
    <>
      {/* Top right floating small controls */}
      <View style={styles.topRightContainer} pointerEvents="box-none">
        <View style={styles.floatingControls}>
          <TouchableOpacity
            style={styles.floatingButton}
            onPress={() => setShowReactions(prev => !prev)}
            activeOpacity={0.7}>
            <Text style={styles.floatingIcon}>😊</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.floatingButton}
            onPress={onToggleScreenShare}
            activeOpacity={0.7}>
            <Text style={styles.floatingIcon}>{isScreenSharing ? '🛑' : '🖥️'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.floatingButton}
            onPress={onToggleParticipants}
            activeOpacity={0.7}>
            <View style={styles.participantIconContainer}>
              <Text style={styles.floatingIcon}>👥</Text>
              {participantCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{participantCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>
        {/* Reactions panel (if open) */}
        {showReactions && (
          <View style={styles.reactionPanelFloating}>
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
      </View>

      {/* Bottom bar main controls */}
      <View style={styles.container}>
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.button, !isMicEnabled && styles.buttonDisabled]}
            onPress={onToggleMic}
            activeOpacity={0.7}>
            <Text style={styles.buttonIcon}>{isMicEnabled ? '🎙️' : '🔇'}</Text>
            <Text style={styles.buttonLabel}>
              {isMicEnabled ? 'Mute' : 'Unmute'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, !isCameraEnabled && styles.buttonDisabled]}
            onPress={onToggleCamera}
            activeOpacity={0.7}>
            <Text style={styles.buttonIcon}>{isCameraEnabled ? '📹' : '📷'}</Text>
            <Text style={styles.buttonLabel}>
              {isCameraEnabled ? 'Cam Off' : 'Cam On'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              (isSwitchCameraDisabled || !isCameraEnabled) && styles.buttonDisabled,
            ]}
            onPress={onSwitchCamera}
            activeOpacity={0.7}
            disabled={isSwitchCameraDisabled || !isCameraEnabled}>
            <Text style={styles.buttonIcon}>🔄</Text>
            <Text style={styles.buttonLabel}>{isFrontCamera ? 'Front' : 'Back'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.leaveButton]}
            onPress={onLeaveRoom}
            activeOpacity={0.7}>
            <Text style={styles.buttonIcon}>📞</Text>
            <Text style={[styles.buttonLabel, styles.leaveLabel]}>Leave</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  // Bottom bar
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0f0f23',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 0,
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  // Top right floating controls
  topRightContainer: {
    position: 'absolute',
    top: 18,
    right: 16,
    zIndex: 20,
    alignItems: 'flex-end',
    pointerEvents: 'box-none',
  },
  floatingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(12, 12, 28, 0.92)',
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    marginBottom: 2,
  },
  floatingButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    marginHorizontal: 2,
  },
  floatingIcon: {
    fontSize: 18,
    color: '#fff',
  },
  reactionPanelFloating: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(12, 12, 28, 0.97)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginTop: 6,
    alignSelf: 'flex-end',
  },
  reactionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  reactionEmoji: {
    fontSize: 18,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    minWidth: 68,
    flex: 1,
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
    flex: 1,
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
