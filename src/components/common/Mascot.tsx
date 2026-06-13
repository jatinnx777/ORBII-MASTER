import React from 'react';
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  StyleProp,
  StyleSheet,
} from 'react-native';

export type MascotPose =
  | 'neutral'
  | 'peek'
  | 'wave'
  | 'shield'
  | 'headset'
  | 'celebrate';

// Static requires so Metro can bundle the assets.
const POSES: Record<MascotPose, ImageSourcePropType> = {
  neutral: require('../../../assets/mascot/neutral.png'),
  peek: require('../../../assets/mascot/peek.png'),
  wave: require('../../../assets/mascot/wave.png'),
  shield: require('../../../assets/mascot/shield.png'),
  headset: require('../../../assets/mascot/headset.png'),
  celebrate: require('../../../assets/mascot/celebrate.png'),
};

type Props = {
  /** Which guardian pose to show. */
  pose?: MascotPose;
  /** Override with a custom image (rarely needed). */
  source?: ImageSourcePropType;
  /** Rendered height in px. Width follows the artwork's aspect ratio. */
  size?: number;
  style?: StyleProp<ImageStyle>;
};

/** ORBII's guardian mascot. */
export function Mascot({ pose = 'neutral', source, size = 160, style }: Props) {
  return (
    <Image
      source={source ?? POSES[pose]}
      style={[{ width: size, height: size }, styles.img, style]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  img: {
    alignSelf: 'center',
  },
});
