import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { useBrandSheet } from './BrandSheet';
import { useCoverage } from '@/context/CoverageContext';

/**
 * Coverage header, in the shape delivery apps use.
 *
 * Small label, one big status line, then the exact place underneath. That
 * pattern works because it answers the only question the user has before they
 * need anything, and it answers it in the first two seconds of the screen.
 *
 * WHERE ORBII DIVERGES FROM THE DELIVERY VERSION, and why it matters.
 *
 * A delivery app's unavailable state is a dead end: no service, come back
 * later, nothing to do here. Ours is not, and must never look like one. When
 * the helper network is unavailable the app is still completely functional:
 * Voice SOS fires, the circle is alerted, SMS goes out, 112 is one tap away.
 * Somebody who reads "SORRY, WE'RE UNAVAILABLE" and concludes the app does not
 * work has been actively harmed by that copy, because they may then not carry
 * it on the night it would have mattered.
 *
 * So the unavailable state names precisely ONE missing thing, the responder
 * network, and immediately says what is still on. It is amber, never red: red
 * means broken, and nothing here is broken.
 */
export function CoverageHeader() {
  const c = useCoverage();
  const sheet = useBrandSheet();

  const tone = useMemo(() => {
    if (c.status === 'FULL_SHIELD_ACTIVE') return 'full' as const;
    if (c.status === 'LOW_COVERAGE') return 'low' as const;
    return 'none' as const;
  }, [c.status]);

  // The address line. Falls back to coordinates, then to a plain string,
  // because the OS geocoder is missing or silent on a lot of Indian devices
  // and an empty row under the headline looks like a rendering bug.
  const place = useMemo(() => {
    if (c.placeLabel) return c.placeLabel;
    if (c.point) return `${c.point.lat.toFixed(4)}, ${c.point.lng.toFixed(4)}`;
    return 'Finding your location…';
  }, [c.placeLabel, c.point]);

  const explain = useCallback(() => {
    if (tone === 'full') {
      sheet.notify({
        title: 'Helpers are nearby',
        tone: 'success',
        icon: 'people',
        body:
          `${c.nearbyHelpersCount} ID-verified responder${
            c.nearbyHelpersCount === 1 ? '' : 's'
          } ${c.nearbyHelpersCount === 1 ? 'is' : 'are'} on duty within about 2 km of you` +
          `${c.placeLabel ? ` in ${c.placeLabel}` : ''}.\n\n` +
          `Fire an SOS and they are dispatched to you in waves until one arrives, alongside ` +
          `your own trusted circle.\n\n` +
          `That number changes through the day as people go on and off duty.\n\n` +
          `ORBII never replaces 112. In a real emergency, make that call too.`,
        acknowledgeLabel: 'Got it',
      });
      return;
    }

    if (tone === 'low') {
      sheet.notify({
        title: 'Network is live here, but quiet',
        tone: 'warning',
        icon: 'people-outline',
        body:
          `The ORBII Helper Network covers your area${
            c.areaName ? ` (${c.areaName})` : ''
          }, but only ${c.nearbyHelpersCount} verified responder${
            c.nearbyHelpersCount === 1 ? ' is' : 's are'
          } on duty within range right now.\n\n` +
          `Everything else is fully active: hands-free Voice SOS, live location to your ` +
          `circle, SMS when data fails, evidence recording, and one-tap 112.\n\n` +
          `Your SOS still reaches your circle instantly, and any responder who is available.`,
        acknowledgeLabel: 'Understood',
      });
      return;
    }

    sheet.notify({
      title: 'Your protection is fully on',
      tone: 'neutral',
      icon: 'shield-checkmark',
      body:
        `The ORBII Helper Network is not live${
          c.placeLabel ? ` in ${c.placeLabel}` : ' in your area'
        } yet. That is the ONLY thing unavailable to you.\n\n` +
        `Working right now, exactly as it does everywhere:\n` +
        `• Hands-free Voice SOS, from a locked phone\n` +
        `• Live location to your trusted circle\n` +
        `• SMS alerts when data fails\n` +
        `• Evidence recording on your device\n` +
        `• One-tap 112\n\n` +
        `We are launching city by city, starting in Delhi NCR. Nothing about your SOS is ` +
        `weaker here: your circle still gets everything, instantly.`,
      acknowledgeLabel: 'Got it',
    });
  }, [tone, c.nearbyHelpersCount, c.placeLabel, c.areaName, sheet]);

  const headline =
    tone === 'full'
      ? 'HELPERS NEARBY'
      : tone === 'low'
        ? 'FEW HELPERS NEARBY'
        : 'NOT IN YOUR AREA YET';

  const label =
    tone === 'none' ? 'Helper network' : 'Verified helpers around you';

  const accent =
    tone === 'full' ? colors.sageDeep : tone === 'low' ? colors.goldDeep : colors.textSecondary;

  return (
    <Pressable
      onPress={explain}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${headline}. ${place}. Tap to see what is active in your area.`}
    >
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>{label}</Text>
            {c.isChecking ? (
              <ActivityIndicator size="small" color={colors.textMuted} style={styles.spin} />
            ) : null}
          </View>

          <View style={styles.headlineRow}>
            <Text style={[styles.headline, { color: accent }]} numberOfLines={1}>
              {headline}
            </Text>
            {tone === 'full' && c.nearbyHelpersCount > 0 ? (
              <View style={styles.countChip}>
                <Text style={styles.countText}>{c.nearbyHelpersCount}</Text>
              </View>
            ) : null}
          </View>

          {/* The exact place, always. In the unavailable state this is the most
              useful line on the screen: it tells somebody WHY, and lets them
              spot a wrong GPS fix rather than believing a wrong answer. */}
          <View style={styles.placeRow}>
            <Ionicons name="location-sharp" size={13} color={colors.textMuted} />
            <Text style={styles.place} numberOfLines={1}>
              {place}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </View>
        </View>

        <View style={[styles.badge, tone === 'full' ? styles.badgeFull : tone === 'low' ? styles.badgeLow : styles.badgeNone]}>
          <Ionicons
            name={tone === 'none' ? 'shield-half' : 'people'}
            size={20}
            color={accent}
          />
        </View>
      </View>

      {/* One line that stops the unavailable state reading as "app is dead".
          Only shown when it is needed; in covered areas it would be noise. */}
      {tone === 'none' ? (
        <View style={styles.reassure}>
          <Ionicons name="checkmark-circle" size={13} color={colors.sageDeep} />
          <Text style={styles.reassureText}>
            Voice SOS, SMS alerts and your circle are fully active here
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  pressed: { opacity: 0.9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  spin: { transform: [{ scale: 0.7 }] },

  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  headline: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    letterSpacing: -0.3,
  },
  countChip: {
    minWidth: 26,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill ?? 999,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
  },
  countText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12.5,
    color: colors.sageDeep,
  },

  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  place: {
    flex: 1,
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    color: colors.textSecondary,
  },

  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeFull: { backgroundColor: colors.sageSoft },
  badgeLow: { backgroundColor: colors.goldSoft },
  badgeNone: { backgroundColor: colors.surfaceAlt },

  reassure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  reassureText: {
    flex: 1,
    fontFamily: fontFamilies.interRegular,
    fontSize: 12,
    color: colors.textSecondary,
  },
});
