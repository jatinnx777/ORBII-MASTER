import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/theme';
import { GuidedStage } from '@/components/onboarding/GuidedStage';
import { remoteVideoFor, videoFor, type OnboardingLang } from '@/onboardingVideos';

/**
 * The two screens before sign-in.
 *
 * Language first, then thirty seconds explaining what ORBII actually is, and
 * only then an email box. Every other app in this category asks who you are
 * before telling you what it does, and then wonders why people stop at the
 * email.
 *
 * WHY LANGUAGE COMES BEFORE EVERYTHING. A woman who does not read English
 * should never have to read an English sentence to find the Hindi button. It is
 * two taps of work and it decides whether the next four minutes are in a
 * language she thinks in.
 *
 * WHY THERE IS A SKIP. She may be installing this because she feels unsafe
 * right now. A safety app that makes her watch a video before she can raise an
 * alarm has failed at the only moment that matters. Skip is not a courtesy here
 * and it must not be removed to improve completion numbers.
 */

export function IntroFlow({
  onDone,
}: {
  /** Hands off to the existing auth flow. `lang` is what she picked. */
  onDone: (lang: OnboardingLang) => void;
}) {
  const [lang, setLang] = useState<OnboardingLang | null>(null);
  const [step, setStep] = useState<'language' | 'what'>('language');

  const source = (key: 'language' | 'what') => {
    const l = lang ?? 'en';
    return videoFor(key, l) ?? remoteVideoFor(key, l);
  };

  if (step === 'language') {
    return (
      <GuidedStage
        index={0}
        total={2}
        title="Choose your language"
        sheetTitle="भाषा चुनिए  ·  CHOOSE A LANGUAGE"
        video={null}
      >
        {/* Deliberately no video and no skip. This screen must be instant and
            readable by someone who reads neither label, which is why both
            options are shown in their own script rather than translated. */}
        <Pressable
          style={styles.choice}
          onPress={() => {
            setLang('hi');
            setStep('what');
          }}
        >
          <Text style={styles.choiceBig}>हिन्दी</Text>
          <Text style={styles.choiceSmall}>Hindi</Text>
        </Pressable>

        <Pressable
          style={styles.choice}
          onPress={() => {
            setLang('en');
            setStep('what');
          }}
        >
          <Text style={styles.choiceBig}>English</Text>
          <Text style={styles.choiceSmall}>अंग्रेज़ी</Text>
        </Pressable>
      </GuidedStage>
    );
  }

  const hi = lang === 'hi';
  return (
    <GuidedStage
      index={1}
      total={2}
      title={hi ? 'ORBII क्या है' : 'What ORBII is'}
      video={source('what')}
      onBack={() => setStep('language')}
      onSkip={() => onDone(lang ?? 'en')}
      skipLabel={hi ? 'छोड़िए, अभी चाहिए' : 'Skip, I need this now'}
      nextLabel={hi ? 'चलिए' : "Let's go"}
      onNext={() => onDone(lang ?? 'en')}
    >
      {/* The clip carries this. The text is for a muted phone on a bus, and is
          the same claim in fewer words, never a different one. */}
      <Text style={styles.body}>
        {hi
          ? 'हर safety app आपसे कहती है: फ़ोन ढूँढो, unlock करो, app खोलो, बटन दबाओ। ठीक उसी वक़्त जब आप यह कुछ नहीं कर सकतीं।'
          : 'Every other safety app asks you to find your phone, unlock it, open the app and press a button. At the exact moment you cannot do any of that.'}
      </Text>
      <Text style={styles.bodyStrong}>
        {hi
          ? 'तो हमने बटन ही हटा दिया। आप बस एक शब्द बोलिए।'
          : 'So we got rid of the button. You just say one word.'}
      </Text>
      <Text style={styles.help}>
        {hi
          ? 'Screen lock हो, फ़ोन बैग में हो, internet ना हो, फिर भी।'
          : 'Screen locked, phone in your bag, no internet needed.'}
      </Text>
    </GuidedStage>
  );
}

const styles = StyleSheet.create({
  choice: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    gap: 2,
  },
  choiceBig: { ...typography.h3, color: colors.textPrimary },
  choiceSmall: { ...typography.caption, color: colors.textMuted },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
  bodyStrong: { ...typography.body, color: colors.textPrimary, fontWeight: '700', lineHeight: 22 },
  help: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
});
