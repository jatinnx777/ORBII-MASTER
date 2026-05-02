import { supabase } from './supabase';
import type { EmergencyContact } from '@/types';

// Server-side store for the user's emergency contacts. Mirrors the redux
// `profile.emergencyContacts` array. SQL schema in
// sql/02_emergency_contacts.sql.

type ContactRow = {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relation: string | null;
};

function rowToContact(row: ContactRow): EmergencyContact {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    relation: row.relation ?? '',
  };
}

export async function listEmergencyContacts(
  userId: string,
): Promise<EmergencyContact[]> {
  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('id, user_id, name, phone, relation')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as ContactRow[]).map(rowToContact);
}

export async function upsertEmergencyContact(
  userId: string,
  contact: EmergencyContact,
): Promise<EmergencyContact | null> {
  const { data, error } = await supabase
    .from('emergency_contacts')
    .upsert(
      {
        id: contact.id,
        user_id: userId,
        name: contact.name,
        phone: contact.phone,
        relation: contact.relation,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select('*')
    .single<ContactRow>();
  if (error || !data) {
    console.warn('[emergency-contacts] upsert failed:', error?.message);
    return null;
  }
  return rowToContact(data);
}

export async function deleteEmergencyContact(
  userId: string,
  contactId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('emergency_contacts')
    .delete()
    .match({ id: contactId, user_id: userId });
  if (error) {
    console.warn('[emergency-contacts] delete failed:', error.message);
    return false;
  }
  return true;
}
