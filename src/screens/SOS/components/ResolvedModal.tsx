import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Mascot, StarRating } from '@/components/common';
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
  onSubmit: (rating: number) => void;
};

// The peak-end moment. People remember an experience by its peak and its
// ending, so the ending of an SOS is designed, not just dismissed: Orbi
// celebrates her being safe and shows who was actually coming for her.
// This is where fear turns into gratitude, and gratitude into retention.
export function ResolvedModal({
  visible,
  helperName,
  respondersCount = 0,
  contactsNotified = 0,
  onSubmit,
}: ResolvedModalProps) {
  const [rating, setRating] = useState(5);
  const hasHelper = helperName.length > 0;

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

          {hasHelper ? (
            <>
              <Text style={styles.rateHint}>Take a moment to rate {helperName}.</Text>
              <View style={styles.stars}>
                <StarRating value={rating} size={36} interactive onChange={setRating} />
              </View>
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
  rateHint: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textSecondary,
  },
  stars: {
    marginVertical: spacing.xs,
  },
});
