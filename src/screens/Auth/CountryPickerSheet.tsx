import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { COUNTRIES, type Country } from './countries';

// Searchable country sheet for the sign-in screen. Slides up over the login,
// dims the page behind it, and closes on the round X — matching the pattern
// people already know from Blinkit / Swiggy, in ORBII's white + green.

export function CountryPickerSheet({
  visible,
  onClose,
  onSelect,
  selected,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (c: Country) => void;
  selected: Country;
}) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(t) || c.dial.includes(t),
    );
  }, [q]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dim} onPress={onClose} />
        <Pressable style={styles.closeBtn} onPress={onClose} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color={colors.textInverse} />
        </Pressable>

        <View style={styles.sheet}>
          <Text style={styles.title}>Select your country</Text>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={19} color={colors.textMuted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search by your country name"
              placeholderTextColor={colors.textMuted}
              style={styles.search}
              autoCorrect={false}
            />
          </View>

          <FlatList
            data={results}
            keyExtractor={(c) => c.code}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const active = item.code === selected.code;
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  <Text style={styles.flag}>{item.flag}</Text>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.dial}>{item.dial}</Text>
                  {active ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.sage} />
                  ) : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>No country matches “{q}”.</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,20,20,0.55)' },
  closeBtn: {
    alignSelf: 'center',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#1F1F1F',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  sheet: {
    height: '84%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 54,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  search: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 15,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowPressed: { backgroundColor: colors.cream },
  flag: { fontSize: 26 },
  name: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textPrimary },
  dial: { fontFamily: fontFamilies.interMedium, fontSize: 14, color: colors.textSecondary },
  empty: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
