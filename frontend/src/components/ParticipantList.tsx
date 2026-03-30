// ============================================================
// ParticipantList Component
// Shows a bottom sheet / side panel with participant details
// ============================================================

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import type {ParticipantListProps, ParticipantInfo} from '../types';

const ParticipantList: React.FC<ParticipantListProps> = ({
  participants,
  visible,
  onClose,
  onPinParticipant,
  onSpotlightParticipant,
}) => {
  const renderParticipant = ({item}: {item: ParticipantInfo}) => (
    <View style={styles.participantRow}>
      {/* Avatar */}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {item.name.charAt(0).toUpperCase()}
        </Text>
      </View>

      {/* Info */}
      <View style={styles.participantInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.participantName}>{item.name}</Text>
          {item.isLocal && (
            <View style={styles.youBadge}>
              <Text style={styles.youBadgeText}>You</Text>
            </View>
          )}
        </View>
        <Text style={styles.participantUuid}>
          UUID: {item.id.substring(0, 8)}...
        </Text>
        <Text style={styles.participantJoined}>
          Joined: {new Date(item.joinedAt).toLocaleTimeString()}
        </Text>
      </View>

      <View style={styles.actionColumn}>
        {item.canPin ? (
          <TouchableOpacity
            style={[
              styles.pinButton,
              item.isPinned && styles.pinButtonActive,
            ]}
            onPress={() => {
              onPinParticipant?.(item.id);
              onClose();
            }}>
            <Text style={styles.pinButtonText}>
              {item.isPinned ? 'Pinned' : 'Pin'}
            </Text>
          </TouchableOpacity>
        ) : null}

        {item.canSpotlight ? (
          <TouchableOpacity
            style={[
              styles.spotlightButton,
              item.isSpotlighted && styles.spotlightButtonActive,
            ]}
            onPress={() => {
              onSpotlightParticipant?.(item.id);
              onClose();
            }}>
            <Text style={styles.spotlightButtonText}>
              {item.isSpotlighted ? 'Remove' : 'Spotlight'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <SafeAreaView style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              Participants ({participants.length})
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Participant List */}
          {participants.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No participants yet</Text>
            </View>
          ) : (
            <FlatList
              data={participants}
              keyExtractor={item => item.id}
              renderItem={renderParticipant}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '70%',
    minHeight: '40%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: 20,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  participantInfo: {
    flex: 1,
  },
  actionColumn: {
    gap: 8,
    marginLeft: 12,
    alignItems: 'flex-end',
  },
  pinButton: {
    backgroundColor: 'rgba(99, 102, 241, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(165, 180, 252, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 12,
  },
  pinButtonActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  pinButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  spotlightButton: {
    backgroundColor: 'rgba(20, 184, 166, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(45, 212, 191, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  spotlightButtonActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
    borderColor: 'rgba(251, 146, 60, 0.4)',
  },
  spotlightButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  participantName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  youBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.3)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  youBadgeText: {
    color: '#a5b4fc',
    fontSize: 10,
    fontWeight: '700',
  },
  participantUuid: {
    color: '#6b7280',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 3,
  },
  participantJoined: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 14,
  },
});

export default React.memo(ParticipantList);
