import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

// Bottom-sheet style matches the waitlist sheets in Plans + Driving so every
// in-app modal feels like the same surface. Subtle gradient on the icon
// halo so the success moment feels celebratory but not over the top.
export function ResolvedModal({
  visible,
  helperName,
  onSubmit,
}: ResolvedModalProps) {
  const [rating, setRating] = useState(5);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.backdrop} onPress={() => undefined}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <LinearGradient
            colors={['#D7F8E5', '#B6F2D6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconWrap}
          >
            <Ionicons name="checkmark-circle" size={56} color={colors.success} />
          </LinearGradient>

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
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
  },
  stars: {
    marginVertical: spacing.sm,
  },
});
