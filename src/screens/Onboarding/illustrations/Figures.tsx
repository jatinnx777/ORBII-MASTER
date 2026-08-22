import React from 'react';
import { G, Path, Rect, Circle, Ellipse } from 'react-native-svg';

/**
 * Flat characters for the onboarding scenes.
 *
 * REWRITTEN after seeing v1 on a device. The first attempt drew the torso as a
 * single wide trapezoid and rotated the raised arm from a point inside it, so
 * the arm disappeared into the body and the whole figure read as a poncho on
 * two sticks. Three things fix that, and they are the rules the reference art
 * follows:
 *
 *   1. SILHOUETTE FIRST. Limbs must break the body outline. An arm that
 *      overlaps the torso in the same colour is invisible, so the raised arm is
 *      drawn as a two-segment path that leaves the shoulder outward before it
 *      goes up, and the hand clears the head.
 *   2. PROPORTION. Head about one fifth of total height, shoulders slightly
 *      narrower than the head is wide, legs a touch shorter than the torso.
 *      Stylised and friendly. Anatomically correct proportion reads as cold in
 *      flat vector.
 *   3. TWO TONES PER FIGURE, NOT ONE. A jacket over a shirt gives the torso an
 *      internal edge, which is what stops a large flat area reading as a slab.
 *
 * No outlines, no shading, no gradients on the figure. The style depends on
 * restraint; one highlight and it becomes a different, worse illustration.
 *
 * All figures draw in the Scene's 400x300 viewBox, positioned by the caller,
 * feet at (x, y).
 */

type Skin = 'deep' | 'mid' | 'light';
const SKIN: Record<Skin, string> = {
  deep: '#7A4A21',
  mid: '#C68642',
  light: '#F0C08A',
};

export type Hair = 'buns' | 'bob' | 'crop' | 'pony';

function HairShape({ style, color }: { style: Hair; color: string }) {
  switch (style) {
    case 'buns':
      return (
        <G fill={color}>
          <Path d="M -11 -6 A 11 11 0 0 1 11 -6 L 11 -9 A 11 11 0 0 0 -11 -9 Z" />
          <Circle cx={-12} cy={-8} r={5} />
          <Circle cx={12} cy={-8} r={5} />
        </G>
      );
    case 'bob':
      return (
        <G fill={color}>
          <Path d="M -11 -4 A 11 11 0 0 1 11 -4 L 11 4 Q 11 9 8 9 L 8 -2 A 8 8 0 0 0 -8 -2 L -8 9 Q -11 9 -11 4 Z" />
        </G>
      );
    case 'pony':
      return (
        <G fill={color}>
          <Path d="M -11 -5 A 11 11 0 0 1 11 -5 L 11 -8 A 11 11 0 0 0 -11 -8 Z" />
          <Path d="M 10 -4 Q 19 0 17 11 Q 12 8 9 2 Z" />
        </G>
      );
    default: // crop
      return (
        <G fill={color}>
          <Path d="M -11 -4 A 11 11 0 0 1 11 -4 L 11 -7 A 11 11 0 0 0 -11 -7 Z" />
        </G>
      );
  }
}

/** Eyes and a small smile. The only face detail the style allows. */
function Face({ skin }: { skin: Skin }) {
  return (
    <G>
      <Circle cx={0} cy={0} r={11} fill={SKIN[skin]} />
      <Circle cx={-3.9} cy={-0.6} r={1.35} fill="#241A12" />
      <Circle cx={3.9} cy={-0.6} r={1.35} fill="#241A12" />
      <Path
        d="M -3.1 3.9 Q 0 6.6 3.1 3.9"
        stroke="#241A12"
        strokeWidth={1.4}
        strokeLinecap="round"
        fill="none"
      />
    </G>
  );
}

export type FigureProps = {
  /** Feet position in the 400x300 scene. */
  x: number;
  y: number;
  /** 1 ≈ 132 units tall. */
  scale?: number;
  skin?: Skin;
  /** Jacket, the outer layer. */
  jacket: string;
  /** Shirt, the strip visible down the middle. */
  shirt: string;
  /** Trousers. */
  bottom: string;
  hairColor?: string;
  hair?: Hair;
  waving?: boolean;
  flip?: boolean;
};

export function Figure({
  x,
  y,
  scale = 1,
  skin = 'mid',
  jacket,
  shirt,
  bottom,
  hairColor = '#241A12',
  hair = 'crop',
  waving = false,
  flip = false,
}: FigureProps) {
  const s = SKIN[skin];
  return (
    <G transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      {/* LEGS. Close together with a small gap, so the stance reads as standing
          rather than straddling. Thicker than v1, which looked like wire. */}
      <Rect x={-13} y={-46} width={12} height={44} rx={6} fill={bottom} />
      <Rect x={1} y={-46} width={12} height={44} rx={6} fill={bottom} />
      <Rect x={-16} y={-6} width={16} height={7} rx={3.5} fill="#241A12" />
      <Rect x={0} y={-6} width={16} height={7} rx={3.5} fill="#241A12" />

      {/* TORSO. Rounded, gently tapered, with real shoulders. */}
      <Path
        d="M -17 -86 Q -17 -92 -11 -92 L 11 -92 Q 17 -92 17 -86 L 15 -46 Q 15 -42 11 -42 L -11 -42 Q -15 -42 -15 -46 Z"
        fill={jacket}
      />
      {/* Shirt strip: the internal edge that keeps the torso from being a slab. */}
      <Path d="M -5 -92 L 5 -92 L 4 -44 L -4 -44 Z" fill={shirt} />

      {/* FAR ARM, hanging. Drawn before the torso edge on the far side so it
          sits behind, which is the only depth cue this style permits. */}
      <G>
        <Rect x={-25} y={-88} width={9} height={36} rx={4.5} fill={jacket} />
        <Circle cx={-20.5} cy={-50} r={5} fill={s} />
      </G>

      {/* NEAR ARM. The part v1 got wrong.
          Waving: upper arm goes OUT from the shoulder, forearm goes UP, so the
          limb clears the torso silhouette entirely and the hand sits beside the
          head where it is legible. */}
      {waving ? (
        <G>
          <Path
            d="M 15 -86 L 27 -78 L 33 -80 L 31 -108 L 23 -108 Z"
            fill={jacket}
          />
          <Circle cx={27} cy={-112} r={5.6} fill={s} />
        </G>
      ) : (
        <G>
          <Rect x={16} y={-88} width={9} height={36} rx={4.5} fill={jacket} />
          <Circle cx={20.5} cy={-50} r={5} fill={s} />
        </G>
      )}

      {/* NECK */}
      <Rect x={-3.5} y={-98} width={7} height={9} rx={3.5} fill={s} />

      {/* HEAD */}
      <G transform="translate(0 -108)">
        <Face skin={skin} />
        <HairShape style={hair} color={hairColor} />
      </G>
    </G>
  );
}

/**
 * A speech bubble: black rounded rect, white bold label, small tail.
 * Text is passed by the caller so font handling stays in one place.
 */
export function Bubble({
  x,
  y,
  w,
  h = 26,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  children?: React.ReactNode;
}) {
  return (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={h / 2} fill="#17161C" />
      <Path d={`M ${x + w * 0.3} ${y + h - 1} l 6 9 l 3 -9 z`} fill="#17161C" />
      {children}
    </G>
  );
}

/** A phone, screen toward the viewer. */
export function Phone({ x, y, scale = 1, rotate = 0 }: { x: number; y: number; scale?: number; rotate?: number }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
      <Rect x={-11} y={-19} width={22} height={38} rx={5} fill="#17161C" />
      <Rect x={-8.5} y={-15.5} width={17} height={31} rx={3} fill="#F5F2E6" />
      <Circle cx={0} cy={-8} r={3.2} fill="#8672CE" />
      <Rect x={-5} y={-1} width={10} height={2.2} rx={1.1} fill="#C3B4EC" />
      <Rect x={-6.5} y={4} width={13} height={2.2} rx={1.1} fill="#C3B4EC" />
    </G>
  );
}

/** Concentric arcs: sound leaving something. */
export function SoundWaves({
  x,
  y,
  color = '#17161C',
  flip = false,
}: {
  x: number;
  y: number;
  color?: string;
  flip?: boolean;
}) {
  const d = flip ? -1 : 1;
  return (
    <G opacity={0.9}>
      {[9, 16, 23].map((r, i) => (
        <Path
          key={r}
          d={`M ${x} ${y - r} A ${r} ${r} 0 0 ${flip ? 0 : 1} ${x} ${y + r}`}
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          fill="none"
          opacity={1 - i * 0.25}
          transform={`translate(${d === -1 ? 0 : 0} 0)`}
        />
      ))}
    </G>
  );
}

/** A soft shadow under a figure, so nobody floats. */
export function Shadow({ x, y, rx = 26 }: { x: number; y: number; rx?: number }) {
  return <Ellipse cx={x} cy={y} rx={rx} ry={5} fill="#B071BE" opacity={0.38} />;
}

/** A shoulder bag, for the hands-free scene. */
export function Bag({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${scale})`}>
      <Path d="M -14 -6 Q 0 -30 14 -6" stroke="#8B4A2B" strokeWidth={3} fill="none" strokeLinecap="round" />
      <Rect x={-16} y={-6} width={32} height={26} rx={5} fill="#E0483C" />
      <Rect x={-16} y={-6} width={32} height={7} rx={3.5} fill="#B8382E" />
    </G>
  );
}
