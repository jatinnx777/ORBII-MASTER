import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies } from '@/theme';

// Pure-RN animated illustration used as the empty-state hero on the
// Circles tab and at the top of the invite screen. No external assets,
// no Lottie, just nested rings + floating member chips that breathe.
//
// Why we draw it ourselves: the design system wants premium polish, and
// shipping a 600 KB Lottie JSON for one illustration eats the bundle
// budget the user is sensitive to (we're a free-tier MVP). Reanimated-
// driven primitives give us 60 FPS at 0 KB cost.

// Floating member chips around the hero core. Every chip uses a tone
// from the official brand palette, the variation is in saturation and
// position, not hue. Keeps the illustration on-brand.
const ICON_KINDS: Array<{
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  angle: number; // degrees around the centre
  radius: number; // distance from centre
  delay: number;
}> = [
  { icon: 'home', color: colors.brandDeep, angle: -60, radius: 84, delay: 0 },
  { icon: 'people', color: colors.brand, angle: 30, radius: 96, delay: 180 },
  { icon: 'airplane', color: colors.brandDeep, angle: 150, radius: 88, delay: 360 },
  { icon: 'school', color: colors.brand, angle: -150, radius: 92, delay: 540 },
];

export function CirclesHero({ size = 220 }: { size?: number }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, enter]);

  const outerScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.04] });
  const outerOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.5] });
  const midScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.02] });
  const midOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.75] });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.brandSoft,
            opacity: outerOpacity,
            transform: [{ scale: outerScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          {
            width: size * 0.74,
            height: size * 0.74,
            borderRadius: (size * 0.74) / 2,
            backgroundColor: 'rgba(87, 198, 145, 0.18)',
            opacity: midOpacity,
            transform: [{ scale: midScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.coreWrap,
          {
            width: size * 0.42,
            height: size * 0.42,
            borderRadius: (size * 0.42) / 2,
            opacity: enter,
            transform: [
              {
                translateY: enter.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.core,
            {
              width: size * 0.42,
              height: size * 0.42,
              borderRadius: (size * 0.42) / 2,
            },
          ]}
        >
          <Text style={[styles.coreEmoji, { fontSize: size * 0.18 }]}>🤝</Text>
        </View>
      </Animated.View>

      {ICON_KINDS.map((k, i) => (
        <FloatingChip
          key={i}
          icon={k.icon}
          color={k.color}
          centre={size / 2}
          angle={k.angle}
          radius={k.radius}
          delay={k.delay}
        />
      ))}
    </View>
  );
}

function FloatingChip({
  icon,
  color,
  centre,
  angle,
  radius,
  delay,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  centre: number;
  angle: number;
  radius: number;
  delay: number;
}) {
  const float = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(enter, {
        toValue: 1,
        damping: 16,
        stiffness: 160,
        useNativeDriver: true,
      }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2200 + delay / 4,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2200 + delay / 4,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const start = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(start);
      loop.stop();
    };
  }, [delay, float, enter]);

  const rad = (angle * Math.PI) / 180;
  const x = centre + Math.cos(rad) * radius - 22;
  const y = centre + Math.sin(rad) * radius - 22;

  const drift = float.interpolate({
    inputRange: [0, 1],
    outputRange: [-3, 3],
  });

  return (
    <Animated.View
      style={[
        styles.chip,
        {
          left: x,
          top: y,
          opacity: enter,
          transform: [
            {
              scale: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [0.4, 1],
              }),
            },
            { translateY: drift },
          ],
        },
      ]}
    >
      <View
        style={[
          styles.chipInner,
          { backgroundColor: tint(color, 0.16), borderColor: tint(color, 0.32) },
        ]}
      >
        <Ionicons name={icon} size={16} color={color} />
      </View>
    </Animated.View>
  );
}

function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
  },
  coreWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F1115',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 22,
    elevation: 6,
  },
  coreEmoji: {
    fontFamily: fontFamilies.poppinsBold,
  },
  chip: {
    position: 'absolute',
    width: 44,
    height: 44,
  },
  chipInner: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
  },
});
