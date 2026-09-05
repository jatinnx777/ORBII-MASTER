import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { RELATION_LABELS, type CircleRelation } from '@/services/circles';
import type { MemberLocation } from '@/services/circle-location';

/**
 * One person on the circle map.
 *
 * The row this replaces printed a name, a timestamp and a distance. Everything
 * else the app knew about that person, and after sql/118 to sql/123 it knows a
 * lot more, was either invisible or crammed into the same grey line: whether
 * she is in an emergency, whether her phone has gone quiet, whether the battery
 * is about to end the whole thing, whether she is moving, and whether what you
 * are looking at is her position or a neighbourhood she chose to share instead.
 *
 * THE ORDER IS THE DESIGN. A card is read top-left first, so the state that
 * changes what you should do goes there and nothing competes with it:
 *
 *   1. Emergency, if there is one. Nothing else on the card matters.
 *   2. Not updating, which is the difference between a live pin and a dead one.
 *   3. Approximate, because a bubbled pin otherwise looks exactly like an
 *      exact one and a reader would act on a precision that is not there.
 *   4. Everything ordinary: when, how far, how much battery.
 *
 * Battery and speed sit on the right as quiet chips. They are useful and they
 * are never the headline, and a low battery reads as amber rather than red
 * because a dying phone is a warning about the app, not about her.
 */

export type MemberCardProps = {
  member: MemberLocation;
  /** Their stable colour on the map, so the card and the pin agree. */
  color: string;
  /** Metres from you, or null when your own position is unknown. */
  distanceM?: number | null;
  relation?: CircleRelation | null;
  selected?: boolean;
  onPress?: () => void;
  /**
   * Actions on the right edge: history, replay, whatever the screen offers.
   *
   * A slot rather than props, because the card should not know what a circle
   * map happens to be able to do with a person. It owns who they are and how
   * they are; what you can do about it belongs to the screen.
   */
  trailing?: React.ReactNode;
};

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function metres(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

type Status = { text: string; color: string; icon: React.ComponentProps<typeof Ionicons>['name'] | null };

/** The one line under the name. Highest-priority true statement, and only one. */
export function statusOf(m: MemberLocation): Status {
  if (m.emergency) {
    return { text: `SOS active · ${ago(m.updatedAt)}`, color: colors.primaryDeep, icon: 'alert-circle' };
  }
  if (m.unreachable) {
    return {
      text: `Not updating · last seen ${ago(m.updatedAt)}`,
      color: colors.goldDeep,
      icon: 'cloud-offline-outline',
    };
  }
  if (!m.sharing) {
    return {
      text: `Location off · last seen ${ago(m.updatedAt)}`,
      color: colors.textMuted,
      icon: 'eye-off-outline',
    };
  }
  if (m.precisionM != null) {
    const r = m.precisionM >= 1000 ? `${(m.precisionM / 1000).toFixed(1)} km` : `${m.precisionM} m`;
    return {
      text: `Approximate, within ${r} · ${ago(m.updatedAt)}`,
      color: colors.textSecondary,
      icon: 'contrast-outline',
    };
  }
  return { text: ago(m.updatedAt), color: colors.textSecondary, icon: null };
}

export function MemberCard({
  member: m,
  color,
  distanceM,
  relation,
  selected,
  onPress,
  trailing,
}: MemberCardProps) {
  const status = statusOf(m);
  // Never dim an emergency, whatever the sharing flag says. During an SOS this
  // card is the most important thing on the screen.
  const dim = !m.sharing && !m.emergency;
  // Charging is a fact about the phone, so it outranks the percentage: 12% on
  // a charger should not read as a problem, and sql/121 does not alert on it.
  const lowBattery = m.battery != null && m.battery <= 15 && m.charging !== true;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${m.name || 'Circle member'}. ${status.text}`}
      style={({ pressed }) => [
        s.card,
        selected && s.cardOn,
        m.emergency && s.cardSOS,
        pressed && { transform: [{ scale: 0.985 }] },
      ]}
    >
      <View style={[s.ring, { borderColor: dim ? '#9a958c' : color }]}>
        {m.photoUri ? (
          <Image source={{ uri: m.photoUri }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, { backgroundColor: dim ? '#9a958c' : color, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={s.initial}>{(m.name || '?').slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={s.body}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>{m.name || 'Circle member'}</Text>
          {relation ? (
            // The whole reason sql/124 exists. Four first names on a map tell
            // you nothing; "Mum" tells you how to read the rest of the card.
            <Text style={s.relation}>{RELATION_LABELS[relation]}</Text>
          ) : null}
        </View>

        <View style={s.statusRow}>
          {status.icon ? <Ionicons name={status.icon} size={12} color={status.color} /> : null}
          <Text
            style={[
              s.status,
              { color: status.color },
              (m.emergency || m.unreachable) && { fontFamily: fontFamilies.poppinsSemiBold },
            ]}
            numberOfLines={1}
          >
            {status.text}
          </Text>
        </View>
      </View>

      <View style={s.right}>
        {distanceM != null ? (
          <Text style={[s.distance, dim && { color: colors.textMuted }]}>{metres(distanceM)}</Text>
        ) : null}

        <View style={s.chips}>
          {/* Speed only while actually moving. A "0 km/h" chip on a parked
              phone is noise, and sql/121 already returns null rather than zero
              for an unknown speed, so anything here is real. */}
          {m.speedKmh != null && m.speedKmh >= 5 ? (
            <View style={s.chip}>
              <Ionicons name="speedometer-outline" size={10} color={colors.textSecondary} />
              <Text style={s.chipText}>{Math.round(m.speedKmh)}</Text>
            </View>
          ) : null}

          {m.battery != null ? (
            <View style={[s.chip, lowBattery && s.chipWarn]}>
              <Ionicons
                name={m.charging === true ? 'flash' : 'battery-half-outline'}
                size={10}
                color={lowBattery ? colors.goldDeep : colors.textSecondary}
              />
              <Text style={[s.chipText, lowBattery && { color: colors.goldDeep }]}>{m.battery}%</Text>
            </View>
          ) : null}
        </View>
      </View>

      {trailing ? <View style={s.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  cardOn: { backgroundColor: 'rgba(134,114,206,0.10)' },
  cardSOS: {
    backgroundColor: 'rgba(239,96,94,0.08)',
    // A left stripe rather than a border or a fill. It marks the row without
    // changing its shape, so an SOS card does not shove the others around when
    // it appears.
    borderLeftWidth: 3,
    borderLeftColor: colors.primaryDeep,
  },

  ring: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2.5,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: '100%', height: '100%', borderRadius: 20 },
  initial: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 17,
    color: colors.textInverse,
  },

  body: { flex: 1, gap: 2, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  name: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  relation: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    color: colors.textMuted,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  status: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12,
    flexShrink: 1,
  },

  right: { alignItems: 'flex-end', gap: 4 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  distance: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13.5,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  chips: { flexDirection: 'row', gap: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.creamDeep,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  chipWarn: { backgroundColor: 'rgba(214,166,79,0.16)' },
  chipText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 10.5,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
});

export default MemberCard;
