import React from 'react';
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  StyleProp,
  StyleSheet,
} from 'react-native';

// The real illustrated Orbi (cropped from the brand icon artwork: bee on its
// peach circle with the coral heart, soft feathered edges).
const ORBI_HERO = require('../../../assets/onboarding/orbi-hero.png');

export type MascotPose =
  | 'neutral'
  | 'peek'
  | 'wave'
  | 'shield'
  | 'headset'
  | 'celebrate';

// One artwork for now, so `pose` is accepted (call sites keep their intent)
// but ignored. When per-pose PNGs exist, map pose → source here and every
// screen gets its pose automatically.
type Props = {
  pose?: MascotPose;
  /** Override with different Orbi artwork (a require'd PNG). */
  source?: ImageSourcePropType;
  size?: number;
  style?: StyleProp<ImageStyle>;
};

/** ORBII's guardian mascot, Orbi. Always the real illustration. */
export function Mascot({ source, size = 160, style }: Props) {
  return (
    <Image
      source={source ?? ORBI_HERO}
      // Square artwork (the Orbi face). resizeMode contain keeps it crisp.
      style={[{ width: size, height: size }, styles.img, style as StyleProp<ImageStyle>]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  img: { alignSelf: 'center' },
});
