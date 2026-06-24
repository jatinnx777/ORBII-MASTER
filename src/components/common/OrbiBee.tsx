import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

// Orbi — ORBII's friendly mascot, drawn entirely in code (no image asset).
// A round honey-orange character with a cream face, big eyes, antennae, a
// glowing heart and a little halo. Scales with `size`.
export function OrbiBee({ size = 150, waving = true }: { size?: number; waving?: boolean }) {
  const s = (n: number) => Math.round(size * n);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* halo ring behind the head */}
      <View
        style={[
          styles.halo,
          {
            width: s(0.92),
            height: s(0.34),
            borderRadius: s(0.46),
            borderWidth: Math.max(3, s(0.03)),
            top: s(0.06),
          },
        ]}
      />

      {/* antennae */}
      <View style={[styles.antenna, { left: s(0.34), top: s(0.0), height: s(0.16), width: Math.max(2, s(0.016)), transform: [{ rotate: '-16deg' }] }]} />
      <View style={[styles.antenna, { right: s(0.34), top: s(0.0), height: s(0.16), width: Math.max(2, s(0.016)), transform: [{ rotate: '16deg' }] }]} />
      <View style={[styles.antBall, { left: s(0.3), top: s(-0.02), width: s(0.09), height: s(0.09), borderRadius: s(0.045) }]} />
      <View style={[styles.antBall, { right: s(0.3), top: s(-0.02), width: s(0.09), height: s(0.09), borderRadius: s(0.045) }]} />

      {/* body */}
      <LinearGradient
        colors={['#FFC24B', '#F7912E']}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={[styles.body, { width: s(0.82), height: s(0.86), borderRadius: s(0.41) }]}
      >
        {/* waving arm */}
        {waving ? (
          <View style={[styles.arm, { left: s(-0.04), top: s(0.18), width: s(0.16), height: s(0.11), borderRadius: s(0.06), transform: [{ rotate: '-28deg' }] }]} />
        ) : null}
        <View style={[styles.arm, { right: s(-0.04), bottom: s(0.18), width: s(0.16), height: s(0.11), borderRadius: s(0.06), transform: [{ rotate: '18deg' }] }]} />

        {/* cream face patch */}
        <View style={[styles.face, { width: s(0.56), height: s(0.5), borderRadius: s(0.27), top: s(0.07) }]}>
          {/* eyes */}
          <View style={styles.eyeRow}>
            <View style={[styles.eye, { width: s(0.1), height: s(0.13), borderRadius: s(0.06) }]}>
              <View style={[styles.shine, { width: s(0.035), height: s(0.035), borderRadius: s(0.02), top: s(0.02), left: s(0.02) }]} />
            </View>
            <View style={{ width: s(0.1) }} />
            <View style={[styles.eye, { width: s(0.1), height: s(0.13), borderRadius: s(0.06) }]}>
              <View style={[styles.shine, { width: s(0.035), height: s(0.035), borderRadius: s(0.02), top: s(0.02), left: s(0.02) }]} />
            </View>
          </View>
          {/* cheeks */}
          <View style={[styles.cheek, { left: s(0.04), width: s(0.08), height: s(0.05), borderRadius: s(0.03) }]} />
          <View style={[styles.cheek, { right: s(0.04), width: s(0.08), height: s(0.05), borderRadius: s(0.03) }]} />
          {/* smile */}
          <View style={[styles.smile, { width: s(0.09), height: s(0.05), borderBottomLeftRadius: s(0.05), borderBottomRightRadius: s(0.05) }]} />
        </View>

        {/* glowing heart on the belly */}
        <View style={[styles.heartGlow, { width: s(0.26), height: s(0.26), borderRadius: s(0.13), bottom: s(0.06) }]}>
          <Ionicons name="heart" size={s(0.16)} color="#FFE8A3" />
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: 'absolute',
    borderColor: '#FFD34D',
    transform: [{ rotate: '-16deg' }],
  },
  antenna: { position: 'absolute', backgroundColor: '#F7912E', borderRadius: 4 },
  antBall: { position: 'absolute', backgroundColor: '#FF7A45' },
  body: {
    alignItems: 'center',
    overflow: 'visible',
    shadowColor: '#E8862A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  arm: { position: 'absolute', backgroundColor: '#F7912E' },
  face: {
    backgroundColor: '#FFF6E6',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: '20%',
  },
  eyeRow: { flexDirection: 'row', alignItems: 'center' },
  eye: { backgroundColor: '#4A2E1E' },
  shine: { position: 'absolute', backgroundColor: '#FFFFFF' },
  cheek: { position: 'absolute', top: '52%', backgroundColor: '#FFB3A0', opacity: 0.8 },
  smile: {
    marginTop: '12%',
    borderColor: '#4A2E1E',
    borderBottomWidth: 2.5,
    backgroundColor: 'transparent',
  },
  heartGlow: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,232,163,0.25)',
  },
});
