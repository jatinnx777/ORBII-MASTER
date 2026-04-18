import React, { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, StarRating } from '@/components/common';
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
  onSubmit: (rating: number) => void;
};

export function ResolvedModal({
  visible,
  helperName,
  onSubmit,
}: ResolvedModalProps) {
  const [rating, setRating] = useState(5);

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="checkmark-circle" size={72} color={colors.success} />
          </View>

          <Text style={styles.title}>Help has arrived</Text>
          <Text style={styles.body}>
            {helperName ? `${helperName} is with you.` : 'You are safe now.'}
            {' '}Take a moment to rate them.
          </Text>

          <View style={styles.stars}>
            <StarRating
              value={rating}
              size={36}
              interactive
              onChange={setRating}
            />
          </View>

          <Button
            label={`Submit ${rating}-star rating`}
            onPress={() => onSubmit(rating)}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    marginBottom: spacing.xs,
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
  },
  stars: {
    marginVertical: spacing.md,
  },
});
