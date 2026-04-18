import React from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Button,
  Card,
  EmptyState,
  ScreenContainer,
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { contactRemoved } from '@/redux/slices/userSlice';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'EmergencyContacts'>;

export function EmergencyContactsScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const contacts = useAppSelector((s) => s.user.profile?.emergencyContacts ?? []);
  const isPremium = useAppSelector((s) => s.user.profile?.isPremium ?? false);

  const max = isPremium ? 20 : 5;
  const atLimit = contacts.length >= max;

  const handleRemove = (id: string, name: string) => {
    Alert.alert('Remove contact?', `${name} will no longer be alerted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          trackEvent('contact_removed');
          dispatch(contactRemoved(id));
        },
      },
    ]);
  };

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Emergency contacts</Text>
        <Text style={styles.subtitle}>
          {contacts.length} of {max} used
          {isPremium ? '' : ' · Upgrade to add up to 20'}
        </Text>
      </View>

      {contacts.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No contacts added"
          body="Add up to 5 people who should be alerted the moment you press SOS."
          actionLabel="Add first contact"
          onAction={() => navigation.navigate('ContactForm', {})}
        />
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card style={styles.item}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Pressable
                style={styles.info}
                onPress={() =>
                  navigation.navigate('ContactForm', { contactId: item.id })
                }
              >
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.relation} · {item.phone}
                </Text>
              </Pressable>
              <Pressable
                hitSlop={10}
                onPress={() => handleRemove(item.id, item.name)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name}`}
              >
                <Ionicons name="trash-outline" size={22} color={colors.primary} />
              </Pressable>
            </Card>
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        />
      )}

      <View style={styles.footer}>
        <Button
          label={atLimit ? `Upgrade for more` : 'Add contact'}
          onPress={() =>
            atLimit
              ? navigation.navigate('PremiumUpgrade')
              : navigation.navigate('ContactForm', {})
          }
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    color: colors.primary,
  },
  info: { flex: 1, gap: 2 },
  name: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 16,
    color: colors.textPrimary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  footer: {
    padding: spacing.lg,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
