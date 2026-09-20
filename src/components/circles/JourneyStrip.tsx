import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius } from '@/theme';
import type { SharedTrip } from '@/services/circles';

/**
 * Live journeys, on the circle map.
 *
 * This is the half of the safety loop that did not exist until sql/139. A
 * journey used to run entirely on her phone: it would fire an SOS if the ETA
 * lapsed, and the people it was for were told nothing at all. A destination
 * and an expected arrival are the two facts that turn a moving pin into
 * something a circle can act on.
 *
 * EVERY STRING HERE SAYS WHAT HAPPENED AND NOTHING MORE.
 *
 *   "12 minutes overdue"        not  "she may be in danger"
 *   "No update for 18 minutes"  not  "she disappeared"
 *
 * A missed ETA is a slow bus far more often than it is anything worse. A
 * system that cries danger at a slow bus teaches four people to swipe the
 * notification away, and then it is worse than nothing on the night it counts.
 * Overdue is a SIGNAL. The SOS is the emergency, and it has its own screen.
 *
 * NO POSITION IS READ HERE. Where she is comes from the member location layer,
 * which snaps to her chosen precision server-side and carries its own
 * freshness. This component only says where she is GOING.
 */

function minutesBetween(a: number, b: number): number {
  return Math.max(0, Math.round((a - b) / 60_000));
}

/** "in 12 min", "12 min overdue", or the arrival time for anything far off. */
export function etaPhrase(trip: SharedTrip, now: number): string {
  if (trip.status === 'overdue') {
    const late = trip.etaAt ? minutesBetween(now, trip.etaAt) : null;
    // "Overdue" with no number is the vaguer, more alarming version of the
    // same fact, so it is only used when there is genuinely no ETA to count
    // from.
    return late === null ? 'Overdue' : `${late} min overdue`;
  }
  if (!trip.etaAt) return 'No arrival time set';
  const mins = minutesBetween(trip.etaAt, now);
  if (mins <= 0) return 'Due now';
  if (mins < 60) return `In ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `In ${h}h` : `In ${h}h ${m}m`;
}

const KIND_ICON: Record<SharedTrip['kind'], React.ComponentProps<typeof Ionicons>['name']> = {
  walk: 'walk',
  cab: 'car',
  commute: 'bus',
  travel: 'airplane',
  custom: 'navigate',
};

export function JourneyStrip({
  journeys,
  nameFor,
  now = Date.now(),
}: {
  journeys: SharedTrip[];
  /** Resolves an owner id to a display name. Falls back to "Someone". */
  nameFor: (userId: string) => string | null;
  now?: number;
}) {
  if (journeys.length === 0) return null;

  // Overdue first. On a screen somebody opened because they are worried, the
  // thing that needs attention should not be below the thing that does not.
  const sorted = [...journeys].sort((a, b) => {
    const rank = (t: SharedTrip) => (t.status === 'overdue' ? 0 : t.status === 'attention' ? 1 : 2);
    return rank(a) - rank(b) || a.startAt - b.startAt;
  });

  return (
    <View style={s.wrap} pointerEvents="none">
      {sorted.map((t) => {
        const late = t.status === 'overdue';
        const who = nameFor(t.ownerId) ?? 'Someone';
        const going = t.destinationLabel ?? t.label;
        return (
          <View key={t.id} style={[s.card, late && s.cardLate]}>
            <View style={[s.icon, late && s.iconLate]}>
              <Ionicons
                name={late ? 'time-outline' : KIND_ICON[t.kind] ?? 'navigate'}
                size={16}
                color={late ? colors.textInverse : colors.brandDeep}
              />
            </View>
            <View style={s.text}>
              <Text style={s.title} numberOfLines={1}>
                {who} is on the way
              </Text>
              <Text style={[s.meta, late && s.metaLate]} numberOfLines={1}>
                {going} · {etaPhrase(t, now)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 14, gap: 8, marginTop: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: radius.lg,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(23,22,28,0.07)',
  },
  // Overdue is marked with weight and a filled icon, not with red. Red is the
  // SOS colour in this app and spending it on a late bus would make the one
  // state that must be unmistakable slightly less so.
  cardLate: { borderColor: colors.brandDeep, borderWidth: 1.5 },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLate: { backgroundColor: colors.brandDeep },
  text: { flex: 1 },
  title: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  meta: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  metaLate: { color: colors.brandDeep, fontFamily: fontFamilies.interMedium },
});
