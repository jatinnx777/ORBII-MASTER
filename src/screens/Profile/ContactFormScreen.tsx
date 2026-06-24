import React, { useMemo, useState } from 'react';
import { appAlert } from '@/components/common';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Input, ScreenContainer } from '@/components/common';
import { colors, fontFamilies, spacing } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { contactAdded, contactUpdated } from '@/redux/slices/userSlice';
import { trackEvent } from '@/services/analytics';
import { upsertEmergencyContact } from '@/services/emergency-contacts';
import {
  formatPhoneForDisplay,
  isValidIndianPhone,
  isValidName,
  toE164India,
} from '@/utils/validation';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'ContactForm'>;
type Route = RouteProp<AppStackParamList, 'ContactForm'>;

export function ContactFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const dispatch = useAppDispatch();
  const contacts = useAppSelector((s) => s.user.profile?.emergencyContacts ?? []);
  const editing = useMemo(
    () => contacts.find((c) => c.id === route.params?.contactId),
    [contacts, route.params?.contactId],
  );

  const [name, setName] = useState(editing?.name ?? '');
  const [relation, setRelation] = useState(editing?.relation ?? '');
  const [phone, setPhone] = useState(
    editing?.phone ? editing.phone.replace('+91', '') : '',
  );

  const nameOk = isValidName(name);
  const phoneOk = isValidIndianPhone(phone);
  const relationOk = relation.trim().length > 0;
  const canSave = nameOk && phoneOk && relationOk;

  React.useEffect(() => {
    navigation.setOptions({ title: editing ? 'Edit contact' : 'Add contact' });
  }, [editing, navigation]);

  const profile = useAppSelector((s) => s.user.profile);

  const handleSave = () => {
    if (!canSave) {
      appAlert('Check the form', 'Name, relation and 10-digit phone required.');
      return;
    }
    const e164 = toE164India(phone);
    const contact = editing
      ? {
          id: editing.id,
          name: name.trim(),
          relation: relation.trim(),
          phone: e164,
        }
      : {
          id: `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
          name: name.trim(),
          relation: relation.trim(),
          phone: e164,
        };

    if (editing) {
      dispatch(contactUpdated(contact));
    } else {
      trackEvent('contact_added');
      dispatch(contactAdded(contact));
    }
    // Fire-and-forget server mirror. Local cache is the truth on-device;
    // server is the truth across reinstalls.
    if (profile?.uid) {
      upsertEmergencyContact(profile.uid, contact).catch(() => undefined);
    }
    navigation.goBack();
  };

  return (
    <ScreenContainer>
      <View style={styles.form}>
        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Mom"
          autoCapitalize="words"
          returnKeyType="next"
        />
        <Input
          label="Relation"
          value={relation}
          onChangeText={setRelation}
          placeholder="e.g. Mother, Husband, Friend"
          autoCapitalize="words"
          returnKeyType="next"
        />
        <Input
          label="Phone"
          value={formatPhoneForDisplay(phone)}
          onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))}
          keyboardType="phone-pad"
          leftAdornment={<Text style={styles.prefix}>+91</Text>}
          maxLength={11}
        />
      </View>
      <View style={styles.footer}>
        <Button
          label={editing ? 'Save changes' : 'Add contact'}
          onPress={handleSave}
          disabled={!canSave}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  footer: {
    marginTop: spacing.xl,
  },
  prefix: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 16,
    color: colors.textPrimary,
  },
});
