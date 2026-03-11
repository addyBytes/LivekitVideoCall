// ============================================================
// AudioControlsBar Component
// Bottom bar with mute, speaker, and end call buttons
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface AudioControlsBarProps {
  isMicEnabled: boolean;
  isSpeakerOn: boolean;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onLeaveRoom: () => void;
}

const AudioControlsBar: React.FC<AudioControlsBarProps> = ({
  isMicEnabled,
  isSpeakerOn,
  onToggleMic,
  onToggleSpeaker,
  onLeaveRoom,
}) => {
  return (
    <View style={styles.container}>
      {/* Mute Toggle */}
      <TouchableOpacity
        style={[styles.button, !isMicEnabled && styles.buttonDisabled]}
        onPress={onToggleMic}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonIcon}>{isMicEnabled ? '🎙️' : '🔇'}</Text>
        <Text style={styles.buttonLabel}>
          {isMicEnabled ? 'Mute' : 'Unmute'}
        </Text>
      </TouchableOpacity>

      {/* Speaker Toggle */}
      <TouchableOpacity
        style={[styles.button, isSpeakerOn && styles.buttonActive]}
        onPress={onToggleSpeaker}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonIcon}>{isSpeakerOn ? '🔊' : '🔈'}</Text>
        <Text style={styles.buttonLabel}>
          {isSpeakerOn ? 'Speaker' : 'Earpiece'}
        </Text>
      </TouchableOpacity>

      {/* End Call */}
      <TouchableOpacity
        style={[styles.button, styles.leaveButton]}
        onPress={onLeaveRoom}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonIcon}>📞</Text>
        <Text style={[styles.buttonLabel, styles.leaveLabel]}>End Call</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    backgroundColor: '#0f0f23',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 40,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    minWidth: 80,
  },
  buttonDisabled: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  buttonActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.25)',
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
  leaveButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
  },
  leaveLabel: {
    color: '#ffffff',
  },
});

export default React.memo(AudioControlsBar);
