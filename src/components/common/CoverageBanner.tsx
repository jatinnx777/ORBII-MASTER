import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { useBrandSheet } from './BrandSheet';
import { useCoverage } from '@/context/CoverageContext';

/**
 * The coverage pill on Home.
 *
 * Its job is to make the answer boring BEFORE it matters. Somebody who learns
 * during an emergency that the responder network does not reach their town has
 * been failed by this component, not by the network. So it sits on the home
 * screen, permanently, stating plainly which of the two shields is live.
 *
 * WHY IT IS A PILL AND NOT A WARNING BANNER. Out-of-coverage is not an error.
 * Most of India is out of coverage today and the app is still fully functional
 * there. A red banner would say "something is wrong with your app", which is
 * false and would push people to uninstall a product that works. Amber, small,
 * and tappable is the correct weight: present, honest, not alarming.
 *
 * THE COUNT IS DELIBERATELY SOFT. "4 nearby" is a live figure that will be
 * different in ten minutes, so it is phrased as context rather than as a
 * promise that four people are coming.
 */
export function CoverageBanner({ compact = false }: { compact?: boolean }) {
  const c = useCoverage();
  const sheet = useBrandSheet();

  const tone = useMemo(() => {
    if (c.status === 'FULL_SHIELD_ACTIVE') return 'full' as const;
    if (c.status === 'LOW_COVERAGE') return 'low' as const;
    return 'personal' as const;
  }, [c.status]);

  const explain = useCallback(() => {
    if (tone === 'full') {
      sheet.notify({
        title: 'Full Shield is active here',
        tone: 'success',
        icon: 'shield-checkmark',
        body:
          `You are inside the ORBII Helper Network coverage area${
            c.areaName ? ` (${c.areaName})` : ''
          }.\n\n` +
          `When you fire an SOS:\n` +
          `• Your trusted circle is alerted with your live location\n` +
          `• ID-verified responders nearby are dispatched to you in waves\n` +
          `• Evidence recording begins on your device\n` +
          `• 112 stays one tap away\n\n` +
          `${c.nearbyHelpersCount} verified responder${
            c.nearbyHelpersCount === 1 ? ' is' : 's are'
          } on duty near you right now. That number changes through the day.\n\n` +
          `ORBII never replaces 112. In a genuine emergency, that call should happen too.`,
        acknowledgeLabel: 'Got it',
      });
      return;
    }

    if (tone === 'low') {
      sheet.notify({
        title: 'Few responders on duty right now',
        tone: 'warning',
        icon: 'people-outline',
        body:
          `The Helper Network is live in your area, but only ${c.nearbyHelpersCount} verified ` +
          `responder${c.nearbyHelpersCount === 1 ? ' is' : 's are'} on duty within range at ` +
          `this moment. This changes through the day.\n\n` +
          `Everything else is fully active:\n` +
          `• Hands-free Voice SOS\n` +
          `• Live location to your trusted circle\n` +
          `• SMS alerts when data fails\n` +
          `• Evidence recording\n` +
          `• One-tap 112\n\n` +
          `Your SOS will still reach your circle and any responders who are available.`,
        acknowledgeLabel: 'Understood',
      });
      return;
    }

    // Out of coverage, offline, or location unreadable. All three get the same
    // sheet, because the practical answer is identical and splitting them would
    // only make somebody feel worse about a distinction they cannot act on.
    sheet.notify({
      title: 'Personal Shield is active',
      tone: 'neutral',
      icon: 'shield-half',
      body:
        `Your core protection is fully operational, everywhere:\n\n` +
        `• Hands-free Voice SOS, from a locked phone\n` +
        `• Live location to your trusted circle\n` +
        `• SMS alerts when data fails\n` +
        `• Evidence recording on your device\n` +
        `• One-tap 112\n\n` +
        `What is not available here: dispatch to ID-verified responders. The ORBII ` +
        `Helper Network is live in Delhi NCR and we are expanding city by city.\n\n` +
        `${
          c.status === 'OFFLINE_PERSONAL_SHIELD'
            ? 'We also could not reach our servers just now, so we cannot confirm responder coverage at your location. Your core protection does not depend on that check.'
            : 'Nothing about your SOS is weaker here. Your circle still gets everything, instantly.'
        }`,
      acknowledgeLabel: 'Got it',
    });
  }, [tone, c.areaName, c.nearbyHelpersCount, c.status, sheet]);

  const label =
    tone === 'full'
      ? `Full Shield Active${
          c.nearbyHelpersCount > 0 ? ` · ${c.nearbyHelpersCount} nearby` : ''
        }`
      : tone === 'low'
        ? 'Shield Active · few responders nearby'
        : 'Personal Shield Active';

  const s = tone === 'full' ? styles.full : tone === 'low' ? styles.low : styles.personal;
  const fg =
    tone === 'full' ? colors.sageDeep : tone === 'low' ? colors.goldDeep : colors.textSecondary;

  return (
    <Pressable
      onPress={explain}
      style={({ pressed }) => [
        styles.pill,
        s,
        compact && styles.compact,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to learn what is active in your area.`}
      hitSlop={8}
    >
      {c.isChecking ? (
        <ActivityIndicator size="small" color={fg} style={styles.spinner} />
      ) : (
        <Ionicons
          name={tone === 'full' ? 'shield-checkmark' : 'shield-half'}
          size={15}
          color={fg}
        />
      )}
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="information-circle-outline" size={14} color={fg} style={styles.info} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.pill ?? 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  compact: { paddingVertical: 5, paddingHorizontal: spacing.sm + 2 },
  pressed: { opacity: 0.75 },
  // Sage for live, gold for thin, neutral for personal-only. Never coral: this
  // is not an alarm, and coral means SOS everywhere else in the app.
  full: { backgroundColor: colors.sageSoft, borderColor: colors.sage },
  low: { backgroundColor: colors.goldSoft, borderColor: colors.gold },
  personal: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  label: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, letterSpacing: 0.1 },
  info: { opacity: 0.7 },
  spinner: { width: 15, height: 15 },
});
