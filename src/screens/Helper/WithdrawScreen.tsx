import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Button,
  Card,
  Input,
  ScreenContainer,
} from '@/components/common';
import { colors, fontFamilies, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  earningsWithdrawn,
  settledToBalance,
} from '@/redux/slices/helperSlice';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'Withdraw'>;

export function WithdrawScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const pending = useAppSelector((s) => s.helper.pendingBalance);
  const [upi, setUpi] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canWithdraw = pending >= 100 && upi.includes('@');

  const handleWithdraw = () => {
    setSubmitting(true);
    // TODO: call payout API with Razorpay / backend
    setTimeout(() => {
      setSubmitting(false);
      dispatch(settledToBalance());
      dispatch(earningsWithdrawn(pending));
      Alert.alert(
        'Withdrawal queued',
        `₹${pending} is on the way to ${upi}. You'll receive it within 24h.`,
        [{ text: 'Done', onPress: () => navigation.goBack() }],
      );
    }, 900);
  };

  return (
    <ScreenContainer>
      <Card style={styles.card}>
        <Text style={styles.label}>Available to withdraw</Text>
        <Text style={styles.amount}>₹{pending}</Text>
        <Text style={styles.meta}>Minimum withdrawal ₹100</Text>
      </Card>

      <View style={styles.form}>
        <Input
          label="UPI ID"
          value={upi}
          onChangeText={setUpi}
          placeholder="name@upi"
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </View>

      <View style={styles.footer}>
        <Button
          label={submitting ? 'Processing…' : `Withdraw ₹${pending}`}
          onPress={handleWithdraw}
          disabled={!canWithdraw}
          loading={submitting}
        />
        <Text style={styles.disclaimer}>
          Demo payout. Production flow will use Razorpay Payouts with 0% commission.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  amount: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 40,
    color: colors.textPrimary,
  },
  meta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  form: {
    marginTop: spacing.xl,
  },
  footer: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  disclaimer: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
