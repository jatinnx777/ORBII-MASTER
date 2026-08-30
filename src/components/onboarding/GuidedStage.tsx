import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { colors, radius, shadows, spacing, typography } from '@/theme';

/**
 * The guided-onboarding stage.
 *
 * Video fills the frame; the question floats on top of it. That ordering is the
 * whole design and it is not decoration: a boxed video with a form underneath
 * reads as a help article somebody can ignore, and a full-bleed person with the
 * question over them reads as being talked to.
 *
 * One decision per screen. Nine fields on one form gets abandoned; nine screens
 * with one field each does not, even though it is more taps. People quit when
 * they feel lost, not when they are busy.
 *
 * NO CLIP IS NOT AN ERROR. Pass nothing and the stage shows a titled panel that
 * reads as deliberate. Every screen works today and gets better the day the
 * filming happens.
 *
 * ONE RULE THIS APP HAS THAT A DELIVERY APP DOES NOT. She may be installing
 * ORBII because she feels unsafe right now. `onSkip` is therefore not a courtesy
 * and must not be removed to improve completion: it is the escape that keeps a
 * safety app usable before its own onboarding is finished.
 */

export type GuidedStageProps = {
  index: number;
  total: number;
  title: string;
  /** Bundled clip (a require) or a remote URL. Null shows the placeholder. */
  video?: number | string | null;
  sheetTitle?: string;
  children: React.ReactNode;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onBack?: () => void;
  /** "Skip, I need this now". Never remove this to push completion. */
  onSkip?: () => void;
  skipLabel?: string;
};

export function GuidedStage({
  index,
  total,
  title,
  video = null,
  sheetTitle,
  children,
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
  onBack,
  onSkip,
  skipLabel = 'Skip, I need this now',
}: GuidedStageProps) {
  const [muted, setMuted] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  // Autoplay, looped, no native controls. Nobody should press play to find out
  // what a step wants, and a scrubber invites skipping the clips that are
  // actually about her safety.
  const player = useVideoPlayer(video && !failed ? (video as never) : null, (p) => {
    p.loop = true;
    p.muted = muted;
    if (video && !failed) p.play();
  });

  React.useEffect(() => {
    try {
      player.muted = muted;
    } catch {
      // Player torn down mid-transition. Never worth a crash on this screen.
    }
  }, [muted, player]);

  // A missing or unuploaded clip must look exactly like a step with no clip.
  // That is what lets a video be added later by uploading one file.
  React.useEffect(() => {
    const sub = player.addListener?.('statusChange', (s: { error?: unknown }) => {
      if (s?.error) setFailed(true);
    });
    return () => sub?.remove?.();
  }, [player]);

  const showVideo = !!video && !failed;
  const pct = total > 0 ? Math.min(1, (index + 1) / total) : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.topRow}>
        {onBack ? (
          <Pressable onPress={onBack} style={styles.circle} hitSlop={10} accessibilityRole="button">
            <Text style={styles.circleGlyph}>{'←'}</Text>
          </Pressable>
        ) : (
          <View style={styles.circle} />
        )}
        <View style={{ flex: 1 }} />
        {onSkip ? (
          <Pressable onPress={onSkip} style={styles.skip} hitSlop={8} accessibilityRole="button">
            <Text style={styles.skipText}>{skipLabel}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.track} accessibilityRole="progressbar">
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>

      <Text style={styles.title}>{title}</Text>

      <View style={styles.stage}>
        {showVideo ? (
          <>
            <VideoView
              style={StyleSheet.absoluteFill}
              player={player}
              nativeControls={false}
              contentFit="cover"
              allowsFullscreen={false}
              allowsPictureInPicture={false}
            />
            <Pressable
              onPress={() => setMuted((m) => !m)}
              style={styles.mute}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={muted ? 'Unmute' : 'Mute'}
            >
              <Text style={styles.muteText}>{muted ? 'OFF' : 'ON'}</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderGlyph}>{'▶'}</Text>
            <Text style={styles.placeholderTitle}>{title}</Text>
          </View>
        )}

        <View style={styles.sheet}>
          {sheetTitle ? <Text style={styles.sheetTitle}>{sheetTitle}</Text> : null}
          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {onNext ? (
            <Pressable
              onPress={onNext}
              disabled={nextDisabled}
              style={[styles.next, nextDisabled && styles.nextOff]}
              accessibilityRole="button"
              accessibilityState={{ disabled: nextDisabled }}
            >
              <Text style={[styles.nextText, nextDisabled && styles.nextTextOff]}>{nextLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  circleGlyph: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  skip: {
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  skipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },

  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: radius.pill, backgroundColor: colors.brand },

  title: {
    ...typography.h3,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },

  stage: {
    flex: 1,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'flex-end',
    ...shadows.card,
  },
  mute: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  muteText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },

  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.xs,
  },
  placeholderGlyph: { color: colors.textMuted, fontSize: 30 },
  placeholderTitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    maxHeight: '78%',
  },
  sheetTitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  sheetContent: { gap: spacing.sm, paddingVertical: spacing.xs },

  next: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  nextOff: { backgroundColor: colors.surfaceAlt },
  nextText: { ...typography.button, color: colors.textInverse },
  nextTextOff: { color: colors.textMuted },
});
