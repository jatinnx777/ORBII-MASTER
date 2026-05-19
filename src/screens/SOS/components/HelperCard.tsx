import React from 'react';
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StarRating } from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { formatDistance, formatEta } from '@/utils/geo';

export type HelperCardData = {
  id: string;
  name: string;
  photoUri: string | null;
  rating: number;
  phone: string;
  distanceMeters: number;
  etaSeconds: number;
};

type HelperCardProps = {
  data: HelperCardData;
};

export function HelperCard({ data }: HelperCardProps) {
  const initial = data.name.trim().charAt(0).toUpperCase();

  const handleCall = () => {
    Linking.openURL(`tel:${data.phone}`).catch(() => undefined);
  };

  return (
    <View style={styles.card}>
      <View style={styles.avatar}>
        {data.photoUri ? (
          <Image source={{ uri: data.photoUri }} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarInitial}>{initial}</Text>
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.name}>{data.name}</Text>
        <View style={styles.metaRow}>
          <StarRating value={data.rating} size={14} />
          <Text style={styles.rating}>{data.rating.toFixed(1)}</Text>
          <Text style={styles.dot}>•</Text>
          <Text style={styles.distance}>
            {formatDistance(data.distanceMeters)} away
          </Text>
        </View>
        <Text style={styles.eta}>{formatEta(data.etaSeconds)}</Text>
      </View>

      <Pressable
        onPress={handleCall}
        accessibilityRole="button"
        accessibilityLabel={`Call ${data.name}`}
        style={({ pressed }) => [styles.callBtn, pressed && styles.callPressed]}
      >
        <Ionicons name="call" size={18} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

const AVATAR = 60;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.brandSoft,
    borderWidth: 2,
    borderColor: colors.brandMid,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.brandDeep,
  },
  info: { flex: 1, gap: 2 },
  name: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 16,
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rating: { ...typography.caption, color: colors.textSecondary },
  dot: { ...typography.caption, color: colors.textMuted, marginHorizontal: 2 },
  distance: { ...typography.caption, color: colors.textSecondary },
  eta: {
    ...typography.label,
    color: colors.success,
    marginTop: 2,
  },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.circle,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callPressed: { opacity: 0.85 },
});
