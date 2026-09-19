import React from 'react';
import { Image, StyleSheet, type ImageSourcePropType } from 'react-native';

/**
 * One illustration per onboarding screen.
 *
 * THESE USED TO BE HAND-BUILT SVG SCENES. Scene.tsx and Figures.tsx drew a
 * lilac city, a figure and a few props in code, and the README in
 * assets/onboarding said plainly what they were: placeholders, to be replaced
 * the moment the painted art existed. The art has been sitting in
 * assets/onboarding since 23 August and nothing ever picked it up, so the app
 * kept shipping the stand-ins.
 *
 * Scene.tsx and Figures.tsx are left in the repo rather than deleted. They are
 * the only record of the palette and composition the painted art was specified
 * against, and they still render if a file here ever goes missing.
 *
 * SHAPE. Every image is 1024x1536, portrait, full body, with the figure's
 * shoes near the bottom edge. Pass `sceneAspect={2 / 3}` to Step alongside
 * them: that is the files' own ratio, so the slot matches the artwork exactly
 * and there is nothing to crop, letterbox or stretch. Any other ratio either
 * cuts her feet off or leaves bars down the sides.
 *
 * WEIGHT. About 1.4MB each, 8.5MB for the set, uncompressed PNG. That is worth
 * knowing before a seventh is added: they are bundled into the APK, not
 * downloaded, so every one of them is paid for by every install including the
 * people who see onboarding once.
 */

function Art({ source, label }: { source: ImageSourcePropType; label: string }) {
  return (
    <Image
      source={source}
      style={styles.art}
      resizeMode="cover"
      // Onboarding is the one place where the illustration IS the explanation,
      // so a screen reader that skips it loses the screen's point, not just a
      // decoration.
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    />
  );
}

/** 1. The word. She says it out loud and the phone hears her. */
export function SceneVoice() {
  return (
    <Art
      source={require('../../../../assets/onboarding/voice.png')}
      label="A woman waving, saying help out loud, with her phone listening beside her"
    />
  );
}

/** 2. Hands free. The phone is in the bag and still listening. */
export function SceneHandsFree() {
  return (
    <Art
      source={require('../../../../assets/onboarding/handsfree.png')}
      label="A woman walking with her phone in her bag, still listening for her"
    />
  );
}

/** 3. Offline. No signal, the alert still leaves. */
export function SceneOffline() {
  return (
    <Art
      source={require('../../../../assets/onboarding/offline.png')}
      label="A woman with no network bars, her alert going out anyway"
    />
  );
}

/** 4. Helpers. The people who come. */
export function SceneHelpers() {
  return (
    <Art
      source={require('../../../../assets/onboarding/helpers.png')}
      label="Two people heading towards a woman who has raised an alert"
    />
  );
}

/** 5. Private. Nothing leaves until she says so. */
export function ScenePrivate() {
  return (
    <Art
      source={require('../../../../assets/onboarding/private.png')}
      label="A woman beside a locked phone, her location held privately"
    />
  );
}

/** 6. Ready. Set up, armed, nothing left to do. */
export function SceneReady() {
  return (
    <Art
      source={require('../../../../assets/onboarding/ready.png')}
      label="A woman standing ready, her phone set up and watching for her"
    />
  );
}

const styles = StyleSheet.create({
  art: { width: '100%', height: '100%' },
});
