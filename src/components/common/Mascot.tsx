import React from 'react';
import {
  ImageStyle,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';

// The mascot character has been retired. To avoid touching every screen that
// used <Mascot pose=... size=.../>, this component keeps the SAME API but now
// renders a clean icon-in-orb in the brand palette. Each old "pose" maps to a
// fitting icon, so call sites keep their intent and the whole app drops the
// mascot at once, with no layout changes (size still drives the diameter).

export type MascotPose =
  | 'neutral'
  | 'peek'
  | 'wave'
  | 'shield'
  | 'headset'
  | 'celebrate';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const POSE: Record<MascotPose, { icon: IconName; accent: string; soft: string }> = {
  neutral: { icon: 'shield-checkmark', accent: colors.brand, soft: colors.brandSoft },
  peek: { icon: 'shield-half', accent: colors.brand, soft: colors.brandSoft },
  wave: { icon: 'hand-left', accent: colors.peach, soft: colors.peachSoft },
  shield: { icon: 'shield-checkmark', accent: colors.brand, soft: colors.brandSoft },
  headset: { icon: 'headset', accent: colors.brand, soft: colors.brandSoft },
  celebrate: { icon: 'sparkles', accent: colors.sage, soft: colors.sageSoft },
};

type Props = {
  pose?: MascotPose;
  size?: number;
  style?: StyleProp<ViewStyle | ImageStyle>;
};

export function Mascot({ pose = 'neutral', size = 160, style }: Props) {
  const p = POSE[pose];
  const inner = Math.round(size * 0.6);
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: p.soft },
        styles.orb,
        style as StyleProp<ViewStyle>,
      ]}
    >
      <View
        style={[
          styles.inner,
          { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: p.accent },
        ]}
      >
        <Ionicons name={p.icon} size={Math.round(inner * 0.5)} color={colors.textInverse} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  orb: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  inner: { alignItems: 'center', justifyContent: 'center' },
});
