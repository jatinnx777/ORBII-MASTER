import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

// Orbi — ORBII's friendly mascot, drawn entirely in code (no image asset).
// A round honey-orange bee with a cream face, big glossy eyes, belly stripes,
// stubby feet, a glowing heart and a halo with its little orbit ball. Scales
// with `size`. `grounded` adds a soft contact shadow under the feet (used on
// hero scenes where Orbi stands on scenery).
export function OrbiBee({
  size = 150,
  waving = true,
  grounded = false,
}: {
  size?: number;
  waving?: boolean;
  grounded?: boolean;
}) {
  const s = (n: number) => Math.round(size * n);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* contact shadow on the ground */}
      {grounded ? (
        <View
          style={[
            styles.ground,
            { width: s(0.62), height: s(0.1), borderRadius: s(0.31), bottom: s(-0.03) },
          ]}
        />
      ) : null}

      {/* halo ring behind the head, with its little glowing orbit ball */}
      <View
        style={[
          styles.halo,
          {
            width: s(0.94),
            height: s(0.34),
            borderRadius: s(0.47),
            borderWidth: Math.max(3, s(0.028)),
            top: s(0.05),
          },
        ]}
      />
      <LinearGradient
        colors={['#FFE28A', '#FFB53E']}
        style={[
          styles.orbitBall,
          { width: s(0.11), height: s(0.11), borderRadius: s(0.055), top: s(0.1), right: s(0.02) },
        ]}
      />

      {/* antennae */}
      <View style={[styles.antenna, { left: s(0.34), top: s(0.0), height: s(0.17), width: Math.max(2, s(0.018)), transform: [{ rotate: '-16deg' }] }]} />
      <View style={[styles.antenna, { right: s(0.34), top: s(0.0), height: s(0.17), width: Math.max(2, s(0.018)), transform: [{ rotate: '16deg' }] }]} />
      <LinearGradient colors={['#FF9A5C', '#F2662E']} style={[styles.antBall, { left: s(0.29), top: s(-0.03), width: s(0.1), height: s(0.1), borderRadius: s(0.05) }]} />
      <LinearGradient colors={['#FF9A5C', '#F2662E']} style={[styles.antBall, { right: s(0.29), top: s(-0.03), width: s(0.1), height: s(0.1), borderRadius: s(0.05) }]} />

      {/* feet peeking out under the body */}
      <View style={[styles.foot, { left: s(0.26), bottom: s(0.0), width: s(0.15), height: s(0.09), borderRadius: s(0.05) }]} />
      <View style={[styles.foot, { right: s(0.26), bottom: s(0.0), width: s(0.15), height: s(0.09), borderRadius: s(0.05) }]} />

      {/* body */}
      <LinearGradient
        colors={['#FFD97A', '#FFB53E', '#F07F1F']}
        locations={[0, 0.55, 1]}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={[styles.body, { width: s(0.82), height: s(0.86), borderRadius: s(0.41), marginBottom: s(0.04) }]}
      >
        {/* soft top-left sheen for a rounded, dimensional look */}
        <View
          style={[
            styles.sheen,
            { width: s(0.4), height: s(0.22), borderRadius: s(0.2), top: s(0.04), left: s(0.08) },
          ]}
        />

        {/* bee stripes across the lower body */}
        <View style={[styles.stripe, { width: s(0.8), height: s(0.075), bottom: s(0.2), borderRadius: s(0.04) }]} />
        <View style={[styles.stripe, { width: s(0.68), height: s(0.065), bottom: s(0.09), borderRadius: s(0.035) }]} />

        {/* waving arm */}
        {waving ? (
          <View style={[styles.arm, { left: s(-0.05), top: s(0.16), width: s(0.18), height: s(0.12), borderRadius: s(0.065), transform: [{ rotate: '-32deg' }] }]} />
        ) : null}
        <View style={[styles.arm, { right: s(-0.05), bottom: s(0.2), width: s(0.18), height: s(0.12), borderRadius: s(0.065), transform: [{ rotate: '18deg' }] }]} />

        {/* cream face patch */}
        <View style={[styles.face, { width: s(0.58), height: s(0.5), borderRadius: s(0.28), top: s(0.07) }]}>
          {/* eyes: big, dark, glossy — two glints each */}
          <View style={styles.eyeRow}>
            <View style={[styles.eye, { width: s(0.125), height: s(0.155), borderRadius: s(0.075) }]}>
              <View style={[styles.shine, { width: s(0.05), height: s(0.05), borderRadius: s(0.025), top: s(0.02), left: s(0.02) }]} />
              <View style={[styles.shineSmall, { width: s(0.022), height: s(0.022), borderRadius: s(0.011), bottom: s(0.025), right: s(0.025) }]} />
            </View>
            <View style={{ width: s(0.09) }} />
            <View style={[styles.eye, { width: s(0.125), height: s(0.155), borderRadius: s(0.075) }]}>
              <View style={[styles.shine, { width: s(0.05), height: s(0.05), borderRadius: s(0.025), top: s(0.02), left: s(0.02) }]} />
              <View style={[styles.shineSmall, { width: s(0.022), height: s(0.022), borderRadius: s(0.011), bottom: s(0.025), right: s(0.025) }]} />
            </View>
          </View>
          {/* cheeks */}
          <View style={[styles.cheek, { left: s(0.035), width: s(0.09), height: s(0.055), borderRadius: s(0.03) }]} />
          <View style={[styles.cheek, { right: s(0.035), width: s(0.09), height: s(0.055), borderRadius: s(0.03) }]} />
          {/* open, happy smile */}
          <View style={[styles.smile, { width: s(0.11), height: s(0.065), borderBottomLeftRadius: s(0.06), borderBottomRightRadius: s(0.06) }]} />
        </View>

        {/* glowing heart on the belly: layered glow + heart */}
        <View style={[styles.heartGlowOuter, { width: s(0.34), height: s(0.34), borderRadius: s(0.17), bottom: s(0.02) }]} />
        <View style={[styles.heartGlow, { width: s(0.24), height: s(0.24), borderRadius: s(0.12), bottom: s(0.07) }]}>
          <Ionicons name="heart" size={s(0.15)} color="#FFF3C4" />
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  ground: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: '#3E5C43',
    opacity: 0.14,
  },
  halo: {
    position: 'absolute',
    borderColor: '#FFD34D',
    transform: [{ rotate: '-16deg' }],
    shadowColor: '#FFC93C',
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  orbitBall: {
    position: 'absolute',
    shadowColor: '#FFC93C',
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  antenna: { position: 'absolute', backgroundColor: '#E8862A', borderRadius: 4 },
  antBall: { position: 'absolute' },
  foot: { position: 'absolute', backgroundColor: '#E8790F' },
  body: {
    alignItems: 'center',
    overflow: 'visible',
    shadowColor: '#C96A15',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 9,
  },
  sheen: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    opacity: 0.32,
    transform: [{ rotate: '-14deg' }],
  },
  stripe: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: '#D96F12',
    opacity: 0.5,
  },
  arm: { position: 'absolute', backgroundColor: '#F2892B' },
  face: {
    backgroundColor: '#FFF6E6',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '18%',
  },
  eyeRow: { flexDirection: 'row', alignItems: 'center' },
  eye: { backgroundColor: '#3D2517', overflow: 'hidden' },
  shine: { position: 'absolute', backgroundColor: '#FFFFFF' },
  shineSmall: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.7)' },
  cheek: { position: 'absolute', top: '54%', backgroundColor: '#FFAD97', opacity: 0.85 },
  smile: {
    marginTop: '10%',
    borderColor: '#3D2517',
    borderBottomWidth: 3,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    backgroundColor: '#7A4326',
  },
  heartGlowOuter: {
    position: 'absolute',
    backgroundColor: 'rgba(255,232,163,0.18)',
  },
  heartGlow: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,232,163,0.35)',
    shadowColor: '#FFE8A3',
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
});
