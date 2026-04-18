import { initializeApp, getApps, FirebaseApp } from 'firebase/app';

// Replace these with the config from your Firebase console:
//   Firebase Console → Project Settings → General → Your apps → Web app
// For MVP development we run in DEV_AUTH_MODE (see services/auth.ts) which
// bypasses Firebase, so leaving these as empty strings is fine until you're
// ready to wire up the real backend.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

export function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfig.apiKey) return null;
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

export const isFirebaseConfigured = (): boolean => !!firebaseConfig.apiKey;
