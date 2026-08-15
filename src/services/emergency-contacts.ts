import { supabase } from './supabase';
import { getItem, setItem } from './storage';
import { reportError } from './error-reporting';
import type { EmergencyContact } from '@/types';

// Durable, per-user local cache of emergency contacts. This is a SAFETY NET:
// contacts are written to Supabase fire-and-forget, so if a write ever fails
// silently (offline, RLS, table missing) the contact would otherwise live only
// in the signed-in session and vanish on sign-out. We keep a copy keyed by uid
// that survives sign-out, merge it with the server on the next login, and
// re-upload anything the server is missing. A guardian number is never lost.
const cacheKey = (uid: string) => `orbii:contacts-cache:${uid}`;

export async function cacheContactsLocally(
  uid: string,
  contacts: EmergencyContact[],
): Promise<void> {
  await setItem(cacheKey(uid), contacts);
}

export async function getCachedContacts(
  uid: string,
): Promise<EmergencyContact[]> {
  return (await getItem<EmergencyContact[]>(cacheKey(uid))) ?? [];
}

// Only for account deletion, a signed-out user keeps their cache so re-login
// restores it, but a deleted account must leave nothing behind.
export async function clearCachedContacts(uid: string): Promise<void> {
  await setItem(cacheKey(uid), []);
}

// Load contacts for a user, merging the server list with the durable cache so
// a contact that never reached Supabase is restored (and re-uploaded). Server
// values win for ids that exist in both.
export async function loadEmergencyContacts(
  userId: string,
): Promise<EmergencyContact[]> {
  const [server, cached] = await Promise.all([
    listEmergencyContacts(userId),
    getCachedContacts(userId),
  ]);
  const byId = new Map(server.map((c) => [c.id, c]));
  const merged = [...server];
  for (const c of cached) {
    if (!byId.has(c.id)) {
      merged.push(c);
      // Repair: this contact only exists locally, push it back to the server.
      void upsertEmergencyContact(userId, c).catch(() => undefined);
    }
  }
  await cacheContactsLocally(userId, merged);
  return merged;
}

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
    // DURABLE write. A lost guardian number means an SOS reaches nobody, so
    // this has to be visible in client_errors, not a console.warn that
    // evaporates in release. The local cache still protects the user.
    reportError(error ?? new Error('no row returned'), {
      category: 'contacts.upsert',
      message: 'emergency contact did not save to Supabase',
      tags: { contactId: contact.id },
      data: { code: error?.code, hint: error?.hint },
    });
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
    reportError(error, {
      category: 'contacts.delete',
      message: 'emergency contact delete did not reach Supabase',
      tags: { contactId },
    });
    return false;
  }
  return true;
}
