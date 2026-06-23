import React from 'react';
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  StyleProp,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';

export type MascotPose =
  | 'neutral'
  | 'peek'
  | 'wave'
  | 'shield'
  | 'headset'
  | 'celebrate';

// NOTE: the old mascot PNGs were removed. Until the new Orbi artwork is dropped
// into the repo, the mascot renders a soft icon placeholder so the build keeps
// working. Pass `source` (a require'd image) to show the real artwork.
const POSE_ICON: Record<MascotPose, React.ComponentProps<typeof Ionicons>['name']> = {
  neutral: 'happy',
  peek: 'happy',
  wave: 'hand-left',
  shield: 'shield-checkmark',
  headset: 'headset',
  celebrate: 'sparkles',
};

type Props = {
  pose?: MascotPose;
  /** Override with the real Orbi artwork (a require'd PNG). */
  source?: ImageSourcePropType;
  size?: number;
  style?: StyleProp<ImageStyle>;
};

/** ORBII's guardian mascot. */
export function Mascot({ pose = 'neutral', source, size = 160, style }: Props) {
  if (source) {
    return (
      <Image
        source={source}
        style={[{ width: size, height: size }, styles.img, style as StyleProp<ImageStyle>]}
        resizeMode="contain"
      />
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Ionicons name={POSE_ICON[pose]} size={size * 0.5} color={colors.peachDeep} />
    </View>
  );
}

const styles = StyleSheet.create({
  img: { alignSelf: 'center' },
  fallback: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.peachSoft,
  },
});
