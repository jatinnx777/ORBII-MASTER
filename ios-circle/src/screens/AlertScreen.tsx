import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, shadows, spacing, weight } from '../theme';
import { describeAlert, minutesSince, type CircleAlert } from '../services/alerts';
import {
  claimEscalation,
  describeClaim,
  getEscalationState,
  releaseEscalation,
  type EscalationClaim,
} from '../services/escalation';

/**
 * One SOS, and the only question that matters on it: who is doing what.
 *
 * This is stage nine of the pipeline, and it is the reason this app exists at
 * all. Four people each seeing "somebody should call 112" is four people
 * assuming somebody else did, and software makes that worse by showing all
 * four the same screen at the same instant.
 *
 * So an action is CLAIMED, out loud, and everyone else watching sees who has
 * it. Releasing is as easy as claiming, because a promise nobody can take back
 * is worse than no promise: it stops the others acting.
 */
export function AlertScreen({
  alert,
  onBack,
}: {
  alert: CircleAlert;
  onBack: () => void;
}) {
  const [claims, setClaims] = useState<EscalationClaim[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setClaims(await getEscalationState(alert.sos_id));
  }, [alert.sos_id]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const rows = await getEscalationState(alert.sos_id);
      if (alive) setClaims(rows);
    };
    void tick();
    const id = setInterval(() => void tick(), 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [alert.sos_id]);

  const mine = claims.find((c) => c.is_me && c.action === 'calling_112');
  const going = claims.find((c) => c.is_me && c.action === 'going_there');

  const toggle = async (action: 'calling_112' | 'going_there', dial: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const held = claims.find((c) => c.is_me && c.action === action);
      if (held) {
        await releaseEscalation(alert.sos_id, action);
      } else {
        await claimEscalation(alert.sos_id, action);
        if (dial) Linking.openURL('tel:112').catch(() => undefined);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const openMap = () => {
    const label = encodeURIComponent(alert.name);
    const url =
      Platform.OS === 'ios'
        ? `maps://?ll=${alert.lat},${alert.lng}&q=${label}`
        : `geo:${alert.lat},${alert.lng}?q=${alert.lat},${alert.lng}(${label})`;
    Linking.openURL(url).catch(() => undefined);
  };

  const coords = `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.who}>{alert.name}</Text>
        <Text style={styles.when}>{describeAlert(alert)}</Text>

        {/* Where she is, in type that can be read out to an operator.
            The only route to police that exists today is a voice call, and the
            first thing they ask is where. Coordinates sit under the place name
            because coordinates are always right and a wrong name sends people
            to the wrong building. */}
        <View style={styles.readOut}>
          <Text style={styles.readOutLabel}>READ THIS TO 112</Text>
          {alert.address ? (
            <Text style={styles.readOutPlace} selectable>
              {alert.address}
            </Text>
          ) : null}
          <Text style={styles.readOutCoords} selectable>
            {coords}
          </Text>
          <Pressable onPress={openMap} hitSlop={8}>
            <Text style={styles.mapLink}>Open in maps</Text>
          </Pressable>
        </View>

        {/* Who has this in hand. Above the actions on purpose: before anyone
            picks an action they need to know what is already being done. */}
        <Text style={styles.section}>WHO IS DOING WHAT</Text>
        <View style={styles.card}>
          {claims.length === 0 ? (
            <Text style={styles.none}>
              Nobody has taken this on yet. If you cannot go, say so to someone who can.
            </Text>
          ) : (
            claims.map((c) => (
              <View key={`${c.action}-${c.claimed_by}`} style={styles.claimRow}>
                <View style={[styles.claimDot, c.is_me && { backgroundColor: colors.sageDeep }]} />
                <Text style={[styles.claimText, c.is_me && { color: colors.sageDeep }]}>
                  {describeClaim(c)}
                </Text>
              </View>
            ))
          )}
        </View>

        <Pressable
          onPress={() => void toggle('calling_112', true)}
          disabled={busy}
          style={({ pressed }) => [styles.cta, mine && styles.ctaOn, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={[styles.ctaText, mine && styles.ctaTextOn]}>
            {mine ? 'I can no longer call' : 'I am calling 112'}
          </Text>
        </Pressable>
        <Text style={styles.hint}>
          {mine
            ? 'Everyone else can see you are calling. If something stops you, tap again so somebody else takes it.'
            : 'This dials 112 and tells everyone else you have it, so nobody assumes another person did.'}
        </Text>

        <Pressable
          onPress={() => void toggle('going_there', false)}
          disabled={busy}
          style={({ pressed }) => [
            styles.secondary,
            going && styles.secondaryOn,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryText, going && styles.secondaryTextOn]}>
            {going ? 'I am no longer going' : 'I am going there'}
          </Text>
        </Pressable>

        <Text style={styles.foot}>
          Raised {minutesSince(alert.created_at)} minutes ago. This screen refreshes every few
          seconds.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  back: { fontSize: 15, color: colors.brandDeep, paddingVertical: spacing.sm },
  scroll: { padding: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xxl },

  who: { fontSize: 30, fontWeight: weight.bold, letterSpacing: -0.6, color: colors.textPrimary },
  when: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },

  readOut: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.coralDeep,
    gap: 4,
  },
  readOutLabel: {
    fontSize: 11,
    fontWeight: weight.bold,
    letterSpacing: 1.1,
    color: colors.coralDeep,
  },
  // Deliberately large. This is read aloud under stress, sometimes in the dark.
  readOutPlace: { fontSize: 22, lineHeight: 28, fontWeight: weight.bold, color: colors.textPrimary },
  readOutCoords: { fontSize: 18, fontWeight: weight.semibold, color: colors.textSecondary },
  mapLink: { fontSize: 14, color: colors.brandDeep, marginTop: spacing.xs },

  section: {
    fontSize: 11,
    fontWeight: weight.bold,
    letterSpacing: 1.1,
    color: colors.textMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.card,
  },
  none: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 },
  claimDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted },
  claimText: { fontSize: 15, fontWeight: weight.semibold, color: colors.textPrimary },

  cta: {
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.coralDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  ctaOn: { backgroundColor: colors.creamDeep },
  ctaText: { fontSize: 17, fontWeight: weight.semibold, color: colors.textInverse },
  ctaTextOn: { color: colors.textSecondary },
  hint: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: spacing.sm },

  secondary: {
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  secondaryOn: { borderColor: colors.sage, backgroundColor: colors.sageSoft },
  secondaryText: { fontSize: 16, fontWeight: weight.semibold, color: colors.textPrimary },
  secondaryTextOn: { color: colors.sageDeep },

  pressed: { opacity: 0.92 },
  foot: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});
