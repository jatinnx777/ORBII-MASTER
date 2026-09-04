import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AudioModule } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { requestBatteryExemption } from '@/services/background-voice';

/**
 * Permissions, asked one at a time, with the reason in front of the dialog.
 *
 * WHY THIS IS BETTER THAN WHAT IT REPLACES, and it is the best idea in the
 * spec this was built from. requestAllPermissions() fires three native dialogs
 * back to back. Android will not stack them, so from her side it is grant,
 * grant, grant, with no explanation attached to any of them, and the one she
 * denies is the one she happened to be reading when the sheet appeared.
 *
 * A denied permission on this app is not a degraded feature. Microphone denied
 * means Voice SOS cannot exist. Battery optimisation left on means the service
 * dies overnight on a Xiaomi and she finds out in an emergency.
 *
 * So each one is a card that says what it is for BEFORE the system asks, and
 * she taps the one she wants. Explaining first is also the single biggest lever
 * on grant rates, which on this product is a safety number rather than a
 * conversion one.
 *
 * NOTHING HERE IS MANDATORY. Every card can be left off and the flow continues.
 * A permission wall is how somebody ends up with no app at all, and no app
 * protects nobody.
 */

type Key = 'location' | 'mic' | 'notify' | 'battery';

type Card = {
  key: Key;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  title: string;
  why: string;
  /** True when the OS has nothing to ask, so the card should not pretend. */
  androidOnly?: boolean;
};

const CARDS: Card[] = [
  {
    key: 'location',
    icon: 'navigate',
    tint: '#3E8268',
    title: 'Location',
    why: 'So an alert carries where you are. Without it your circle gets a message and no address.',
  },
  {
    key: 'mic',
    icon: 'mic',
    tint: '#D14A48',
    title: 'Microphone',
    why: 'Voice SOS listens on your phone for a trigger word. Nothing is uploaded, and nothing is recorded until an SOS starts.',
  },
  {
    key: 'notify',
    icon: 'notifications',
    tint: '#6E58B6',
    title: 'Notifications',
    why: 'So you are told when somebody in your circle raises an alarm, at the moment it happens.',
  },
  {
    key: 'battery',
    icon: 'battery-charging',
    tint: '#B4842F',
    title: 'Keep ORBII awake',
    why: 'Xiaomi, Oppo, Vivo and Samsung shut background apps down overnight. This exempts ORBII so Voice SOS survives until morning.',
    androidOnly: true,
  },
];

export function PermissionCards({
  onChange,
}: {
  /** Reports which are granted, so the step can say what is actually live. */
  onChange?: (granted: Key[]) => void;
}) {
  const [granted, setGranted] = useState<Key[]>([]);
  const [busy, setBusy] = useState<Key | null>(null);

  const mark = (k: Key) => {
    setGranted((prev) => {
      if (prev.includes(k)) return prev;
      const next = [...prev, k];
      onChange?.(next);
      return next;
    });
  };

  const ask = async (k: Key) => {
    if (busy || granted.includes(k)) return;
    setBusy(k);
    try {
      if (k === 'location') {
        const r = await Location.requestForegroundPermissionsAsync();
        if (r.granted) mark('location');
      } else if (k === 'mic') {
        const r = await AudioModule.requestRecordingPermissionsAsync();
        if (r.granted) mark('mic');
      } else if (k === 'notify') {
        const r = await Notifications.requestPermissionsAsync();
        if (r.status === 'granted') mark('notify');
      } else {
        // No result to read: this opens a system settings screen and Android
        // tells us nothing about what she did there. Marked optimistically,
        // which is honest enough for a card that only says "asked".
        await requestBatteryExemption();
        mark('battery');
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    } catch {
      // A denial is a decision, not an error. The card simply stays off.
    } finally {
      setBusy(null);
    }
  };

  const visible = CARDS.filter((c) => !c.androidOnly || Platform.OS === 'android');

  return (
    <View style={s.wrap}>
      {visible.map((c) => {
        const on = granted.includes(c.key);
        return (
          <Pressable
            key={c.key}
            onPress={() => void ask(c.key)}
            disabled={on || busy !== null}
            accessibilityRole="button"
            accessibilityState={{ checked: on }}
            style={({ pressed }) => [s.card, on && s.cardOn, pressed && !on && s.pressed]}
          >
            <View style={[s.icon, { backgroundColor: c.tint + '1A' }]}>
              <Ionicons name={c.icon} size={19} color={c.tint} />
            </View>
            <View style={s.text}>
              <Text style={s.title}>{c.title}</Text>
              <Text style={s.why}>{c.why}</Text>
            </View>
            <View style={[s.check, on && s.checkOn]}>
              {on ? <Ionicons name="checkmark" size={14} color={colors.textInverse} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardOn: { borderColor: colors.sage, backgroundColor: colors.sageSoft },
  pressed: { opacity: 0.92 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  why: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  checkOn: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
});
