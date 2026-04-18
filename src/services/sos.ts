import type { SOSLocation, SOSRecord, UserProfile } from '@/types';

// Creates a new SOS record. Dev-mock implementation; swap to Firestore:
//   addDoc(collection(db, 'sos'), { ... serverTimestamp(), status: 'active' })
export async function createSOS(
  user: UserProfile,
  location: SOSLocation,
): Promise<SOSRecord> {
  await delay(300);
  const record: SOSRecord = {
    id: `sos_${Date.now()}`,
    userId: user.uid,
    userName: user.name,
    userPhoto: user.photoUri,
    location,
    timestamp: Date.now(),
    status: 'active',
    helpers: [],
    responder: null,
    responseTime: null,
    resolvedAt: null,
    rating: null,
  };
  console.log('[sos:dev] created', record);
  return record;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
