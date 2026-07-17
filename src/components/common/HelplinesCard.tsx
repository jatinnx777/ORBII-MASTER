import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';

// India's official, free, 24/7 helplines. Shown to BOTH sides of a rescue — the
// victim and the responding helper — because in a real emergency either of them
// may need to reach the police, an ambulance, or a specialist line fast, and
// hunting for the number is exactly what you can't afford then.
const LINES = [
  { label: 'Emergency', number: '112', icon: 'alert-circle' as const },
  { label: 'Police', number: '100', icon: 'shield' as const },
  { label: 'Ambulance', number: '108', icon: 'medkit' as const },
  { label: 'Women', number: '1091', icon: 'woman' as const },
];

export function HelplinesCard({ compact }: { compact?: boolean }) {
  const call = (n: string) => Linking.openURL(`tel:${n}`).catch(() => undefined);

  return (
    <View style={styles.card}>
      {!compact ? (
        <Text style={styles.heading}>Emergency helplines</Text>
      ) : null}
      <View style={styles.row}>
        {LINES.map((l) => (
          <Pressable
            key={l.number}
            onPress={() => call(l.number)}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel={`Call ${l.label} on ${l.number}`}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={l.icon} size={17} color={colors.coralDeep} />
            </View>
            <Text style={styles.number}>{l.number}</Text>
            <Text style={styles.label}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  heading: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.coralSoft,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    gap: 3,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  number: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.coralDeep },
  label: { ...typography.caption, fontSize: 10.5, color: colors.textSecondary },
});
