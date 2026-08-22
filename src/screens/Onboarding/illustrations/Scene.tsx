import React from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

/**
 * The illustration stage every onboarding screen sits on.
 *
 * Built as one flat vector scene rather than a bitmap, for three reasons that
 * matter here: it is a few kB instead of a few hundred, it stays sharp on a
 * 1440p phone, and the palette is code, so retinting the whole onboarding is
 * one edit rather than six re-exports.
 *
 * THE STYLE, held to deliberately:
 *   - A soft lilac sky, darkening downward. No hard horizon.
 *   - A city silhouette in one flat tone, slightly deeper than the sky. Never
 *     outlined. Depth comes from value, not from strokes.
 *   - Foliage anchoring the bottom corners, so the characters stand in a place
 *     rather than floating on a gradient.
 *   - Sparkles and a few loose accent dots. Sparse: they are punctuation, not
 *     texture, and the moment there are more than a handful the scene reads as
 *     busy rather than lively.
 *
 * ONE THING IT DOES NOT DO, on instruction: no ring of circular badges around
 * the character. That motif is everywhere in onboarding design and it is the
 * fastest way to make a screen look like every other screen.
 */

export const SKY = {
  top: '#F0DCF2',
  bottom: '#E3BFE6',
  city: '#DCAEE2',
  cityFar: '#E6C4EA',
  leaf: '#B476C4',
  leafGreen: '#3FBE8F',
  accentOrange: '#F97A3D',
  accentYellow: '#FFD24A',
  spark: '#FFFFFF',
};

/** A four-point sparkle. Concave sides, which is what stops it reading as a plus sign. */
function Spark({ x, y, s, o = 1 }: { x: number; y: number; s: number; o?: number }) {
  return (
    <Path
      d={`M ${x} ${y - s} Q ${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y}
          Q ${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s}
          Q ${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y}
          Q ${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z`}
      fill={SKY.spark}
      opacity={o}
    />
  );
}

/** An open arc. Reads as motion and keeps the corners from going dead. */
function Arc({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <Path
      d={`M ${x - r} ${y} A ${r} ${r} 0 0 1 ${x + r} ${y}`}
      stroke={color}
      strokeWidth={2.6}
      strokeLinecap="round"
      fill="none"
      opacity={0.85}
    />
  );
}

/**
 * The stage. Children are drawn on top, in the same 400x300 viewBox, so a
 * character composes against the scene without any coordinate maths.
 */
export function Scene({ children }: { children?: React.ReactNode }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={SKY.top} />
          <Stop offset="1" stopColor={SKY.bottom} />
        </LinearGradient>
      </Defs>

      <Rect x="0" y="0" width="400" height="300" fill="url(#sky)" />

      {/* Far skyline, lighter, so the near one has something to sit against. */}
      <G opacity={0.55}>
        <Rect x="12" y="150" width="34" height="150" fill={SKY.cityFar} rx="3" />
        <Rect x="86" y="132" width="26" height="168" fill={SKY.cityFar} rx="3" />
        <Rect x="300" y="140" width="30" height="160" fill={SKY.cityFar} rx="3" />
        <Rect x="356" y="126" width="32" height="174" fill={SKY.cityFar} rx="3" />
      </G>

      {/* Near skyline. A dome and a spire break the rectangle rhythm, which is
          what keeps a flat skyline from reading as a bar chart. */}
      <G fill={SKY.city}>
        <Rect x="40" y="168" width="44" height="132" rx="3" />
        <Rect x="112" y="150" width="38" height="150" rx="3" />
        <Rect x="176" y="176" width="30" height="124" rx="3" />
        <Rect x="228" y="158" width="42" height="142" rx="3" />
        <Rect x="266" y="182" width="28" height="118" rx="3" />
        <Rect x="330" y="166" width="36" height="134" rx="3" />
        <Path d="M 131 150 a 19 19 0 0 1 -38 0 z" transform="translate(0,-1)" />
        <Rect x="129" y="112" width="4" height="40" rx="2" />
      </G>

      {/* Windows. Two tones so the buildings do not read as solid slabs. */}
      <G fill="#FFFFFF" opacity={0.30}>
        <Rect x="50" y="182" width="7" height="10" rx="1.5" />
        <Rect x="64" y="182" width="7" height="10" rx="1.5" />
        <Rect x="50" y="202" width="7" height="10" rx="1.5" />
        <Rect x="238" y="174" width="7" height="10" rx="1.5" />
        <Rect x="252" y="174" width="7" height="10" rx="1.5" />
        <Rect x="238" y="194" width="7" height="10" rx="1.5" />
        <Rect x="340" y="182" width="7" height="10" rx="1.5" />
        <Rect x="354" y="182" width="7" height="10" rx="1.5" />
      </G>

      {/* Ground. A single soft band, no line, so the characters are grounded
          without a horizon cutting the composition in half. */}
      <Ellipse cx="200" cy="308" rx="260" ry="42" fill="#D9A6E0" opacity={0.5} />

      {/* Foliage, bottom corners. One green leaf on each side is the only
          non-purple in the scene, which is exactly why it works. */}
      <G>
        <Path d="M 0 300 C 6 262 26 246 44 250 C 34 268 22 286 12 300 Z" fill={SKY.leaf} opacity={0.55} />
        <Path d="M -4 300 C 4 274 20 262 34 266 C 24 280 14 292 6 300 Z" fill={SKY.leafGreen} opacity={0.9} />
        <Path d="M 400 300 C 392 258 370 242 350 248 C 362 268 376 286 388 300 Z" fill={SKY.leaf} opacity={0.55} />
        <Path d="M 404 300 C 396 272 378 260 364 264 C 374 278 386 292 394 300 Z" fill={SKY.leafGreen} opacity={0.9} />
      </G>

      {/* Punctuation. Kept to a handful. */}
      <Spark x={54} y={54} s={11} />
      <Spark x={344} y={72} s={9} o={0.9} />
      <Spark x={286} y={40} s={6} o={0.8} />
      <Circle cx={30} cy={104} r={5} fill={SKY.accentOrange} />
      <Circle cx={372} cy={132} r={4.5} fill={SKY.accentOrange} />
      <Circle cx={92} cy={72} r={4} fill={SKY.accentYellow} />
      <Circle cx={318} cy={186} r={3.5} fill={SKY.accentYellow} />
      <Arc x={330} y={104} r={11} color="#C86BD8" />
      <Arc x={70} y={140} r={9} color="#C86BD8" />

      {children}
    </Svg>
  );
}
