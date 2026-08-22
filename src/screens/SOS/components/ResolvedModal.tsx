import React, { useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { appAlert, Button, Mascot, StarRating } from '@/components/common';
import { tipHelper } from '@/services/razorpay';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '@/theme';

type ResolvedModalProps = {
  visible: boolean;
  helperName: string;
  // Peak-end summary numbers. Only REAL counts are ever shown: rows render
  // solely when the count is > 0, so a lonely SOS never fakes reassurance.
  respondersCount?: number;
  contactsNotified?: number;
  sosId?: string;
  onSubmit: (rating: number) => void;
};

const TIP_OPTIONS = [20, 50, 100];

// The peak-end moment. People remember an experience by its peak and its
// ending, so the ending of an SOS is designed, not just dismissed: Orbi
// celebrates her being safe and shows who was actually coming for her.
// This is where fear turns into gratitude, and gratitude into retention.
export function ResolvedModal({
  visible,
  helperName,
  respondersCount = 0,
  contactsNotified = 0,
  sosId,
  onSubmit,
}: ResolvedModalProps) {
  const [rating, setRating] = useState(5);
  const [tipping, setTipping] = useState<number | null>(null);
  const [tipped, setTipped] = useState(false);
  const hasHelper = helperName.length > 0;

  // Opens the OS share sheet. The text carries no location, no timestamp, no
  // helper name and no description of the incident, on purpose. See the comment
  // at the call site.
  const shareSafe = async () => {
    try {
      await Share.share({
        message:
          "I'm safe. I had a scare tonight and used ORBII to get help — it worked. " +
          'If you walk home alone, get it: orbii.in',
      });
    } catch {
      // She dismissed the sheet, or no target app. Nothing to report.
    }
  };

  const sendTip = async (amount: number) => {
    if (tipping) return;
    setTipping(amount);
    const res = await tipHelper(amount, helperName, sosId);
    setTipping(null);
    if (res.ok) {
      setTipped(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } else if (!res.cancelled) {
      appAlert('Tip failed', res.error ?? 'Please try again.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.backdrop} onPress={() => undefined}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Mascot pose="celebrate" size={110} />

          <Text style={styles.title}>You're safe.</Text>
          <Text style={styles.body}>
            {hasHelper
              ? `${helperName} reached you. I stayed with you the whole time.`
              : 'I stayed with you the whole time.'}
          </Text>

          {contactsNotified > 0 || respondersCount > 0 ? (
            <View style={styles.summaryCard}>
              {contactsNotified > 0 ? (
                <View style={styles.summaryRow}>
                  <View style={styles.summaryIcon}>
                    <Ionicons name="people" size={16} color={colors.sageDeep} />
                  </View>
                  <Text style={styles.summaryText}>
                    {contactsNotified === 1
                      ? '1 trusted contact was alerted with your live location'
                      : `${contactsNotified} trusted contacts were alerted with your live location`}
                  </Text>
                </View>
              ) : null}
              {respondersCount > 0 ? (
                <View style={styles.summaryRow}>
                  <View style={styles.summaryIcon}>
                    <Ionicons name="walk" size={16} color={colors.sageDeep} />
                  </View>
                  <Text style={styles.summaryText}>
                    {respondersCount === 1
                      ? '1 helper was coming for you'
                      : `${respondersCount} helpers were coming for you`}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* The line that matters most.
              Everything above is a report; this is the only part addressed to
              her as a person. Deliberately short and not cheerful: somebody who
              has just been frightened does not want to be congratulated, she
              wants to know she is not on her own. */}
          <View style={styles.standWith}>
            <Ionicons name="heart" size={16} color={colors.coralDeep} />
            <Text style={styles.standWithText}>
              That took courage. You are not on your own, and reaching for help
              was exactly the right thing to do.
            </Text>
          </View>

          {/* Sharing.
              One button, not a row of platform logos, because the OS share
              sheet already contains Instagram, X, WhatsApp, Telegram, Messages
              and everything else she actually uses, and it stays correct when
              those apps change.

              WHAT IT SHARES IS THE CAREFUL PART. No location, no time, no
              helper's name, no mention of what happened. A message written in
              the minutes after an emergency is written under the worst possible
              conditions for judgement, and it is permanent and public. So the
              default says only that she is safe, which is the thing the people
              who love her actually need, and leaves the story hers to tell if
              and when she wants to. She can edit it in the share sheet before
              it goes anywhere. */}
          <View style={styles.shareBlock}>
            <Pressable
              onPress={() => void shareSafe()}
              style={({ pressed }) => [styles.shareBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Let people know you are safe"
            >
              <Ionicons name="share-social-outline" size={17} color={colors.brandDeep} />
              <Text style={styles.shareBtnText}>Let people know I'm safe</Text>
            </Pressable>
            <Text style={styles.shareHint}>
              Sends only that you're okay. Never your location or what happened.
            </Text>
          </View>

          {hasHelper ? (
            <>
              <Text style={styles.rateHint}>Take a moment to rate {helperName}.</Text>
              <View style={styles.stars}>
                <StarRating value={rating} size={36} interactive onChange={setRating} />
              </View>

              {tipped ? (
                <View style={styles.tipDone}>
                  <Ionicons name="heart" size={15} color={colors.coralDeep} />
                  <Text style={styles.tipDoneText}>Tip sent. Thank you for being kind.</Text>
                </View>
              ) : (
                <View style={styles.tipBlock}>
                  <Text style={styles.tipTitle}>Say thanks to {helperName}?</Text>
                  <View style={styles.tipRow}>
                    {TIP_OPTIONS.map((amt) => (
                      <Pressable
                        key={amt}
                        onPress={() => sendTip(amt)}
                        disabled={tipping !== null}
                        style={({ pressed }) => [
                          styles.tipChip,
                          tipping === amt && styles.tipChipActive,
                          pressed && { opacity: 0.9 },
                        ]}
                      >
                        <Text style={styles.tipChipText}>
                          {tipping === amt ? '…' : `₹${amt}`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              <Button
                label={`Submit ${rating}-star rating`}
                onPress={() => onSubmit(rating)}
              />
            </>
          ) : (
            <Button label="Done" onPress={() => onSubmit(rating)} />
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
    alignItems: 'center',
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
  },
  summaryCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.sageSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryText: {
    flex: 1,
    ...typography.bodyMedium,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  standWith: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.coralSoft,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  standWithText: {
    ...typography.body,
    flex: 1,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  shareBlock: { alignSelf: 'stretch', marginTop: spacing.md, gap: 6 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 13,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brandSoft,
    backgroundColor: colors.surface,
  },
  shareBtnText: {
    ...typography.button,
    fontSize: 14.5,
    color: colors.brandDeep,
  },
  shareHint: {
    ...typography.caption,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.textMuted,
    textAlign: 'center',
  },
  pressed: { opacity: 0.9 },
  rateHint: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textSecondary,
  },
  stars: {
    marginVertical: spacing.xs,
  },
  tipBlock: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xs },
  tipTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  tipRow: { flexDirection: 'row', gap: spacing.sm },
  tipChip: {
    minWidth: 66,
    alignItems: 'center',
    backgroundColor: colors.sageSoft,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  tipChipActive: { backgroundColor: colors.sage },
  tipChipText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.sageDeep },
  tipDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.coralSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginVertical: spacing.xs,
  },
  tipDoneText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.coralDeep },
});
