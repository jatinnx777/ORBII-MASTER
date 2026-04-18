import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme';

type StarRatingProps = {
  value: number;
  max?: number;
  size?: number;
  interactive?: boolean;
  onChange?: (value: number) => void;
};

export function StarRating({
  value,
  max = 5,
  size = 20,
  interactive = false,
  onChange,
}: StarRatingProps) {
  const stars = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <View style={styles.row}>
      {stars.map((n) => {
        const filled = n <= Math.round(value);
        const icon = filled ? 'star' : 'star-outline';
        if (!interactive) {
          return (
            <Ionicons
              key={n}
              name={icon}
              size={size}
              color={colors.accent}
              style={styles.star}
            />
          );
        }
        return (
          <Pressable
            key={n}
            onPress={() => onChange?.(n)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
          >
            <Ionicons
              name={icon}
              size={size}
              color={colors.accent}
              style={styles.star}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  star: {
    marginRight: 2,
  },
});
