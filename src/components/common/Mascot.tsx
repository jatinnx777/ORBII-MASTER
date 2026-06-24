import React from 'react';
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  StyleProp,
  StyleSheet,
} from 'react-native';
import { OrbiBee } from './OrbiBee';

export type MascotPose =
  | 'neutral'
  | 'peek'
  | 'wave'
  | 'shield'
  | 'headset'
  | 'celebrate';

// The old mascot PNGs were removed, so the guardian now renders the code-drawn
// Orbi bee everywhere. Pass `source` (a require'd image) to override with real
// artwork later.
type Props = {
  pose?: MascotPose;
  /** Override with real Orbi artwork (a require'd PNG). */
  source?: ImageSourcePropType;
  size?: number;
  style?: StyleProp<ImageStyle>;
};

/** ORBII's guardian mascot — Orbi. */
export function Mascot({ source, size = 160, style }: Props) {
  if (source) {
    return (
      <Image
        source={source}
        style={[{ width: size, height: size }, styles.img, style as StyleProp<ImageStyle>]}
        resizeMode="contain"
      />
    );
  }
  return <OrbiBee size={size} />;
}

const styles = StyleSheet.create({
  img: { alignSelf: 'center' },
});
