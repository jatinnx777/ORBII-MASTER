import type { UserProfile } from '@/types';
import { toE164India } from '@/utils/validation';

// ORBII auth service.
//
// MVP strategy: a dev-mode mock that accepts any valid 10-digit Indian number
// and the OTP "123456". This lets us build and demo the entire flow without
// waiting on Firebase phone-auth reCAPTCHA setup (which requires a custom
// Expo dev-client build).
//
// When ready for real Firebase phone auth, flip DEV_AUTH_MODE to false and
// implement the Firebase path in sendOtp/verifyOtp. For Expo, the current
// recommended route is @react-native-firebase/auth via a dev-client build,
// since the web firebase SDK's PhoneAuthProvider requires reCAPTCHA.
const DEV_AUTH_MODE = true;
const DEV_OTP = '123456';

export type SendOtpResult = {
  verificationId: string;
};

export type VerifyOtpResult = {
  profile: UserProfile;
  needsProfile: boolean;
};

function makeMockProfile(phone: string): UserProfile {
  return {
    uid: `dev_${phone.replace(/\D/g, '')}`,
    phone: toE164India(phone),
    name: null,
    photoUri: null,
    emergencyContacts: [],
    isHelper: false,
    isPremium: false,
    createdAt: Date.now(),
  };
}

export async function sendOtp(phone: string): Promise<SendOtpResult> {
  if (DEV_AUTH_MODE) {
    await delay(600);
    console.log(`[auth:dev] OTP for ${toE164India(phone)} is ${DEV_OTP}`);
    return { verificationId: `dev_${Date.now()}` };
  }
  throw new Error(
    'Real Firebase phone auth is not wired up yet. ' +
      'Implement via @react-native-firebase/auth in a dev-client build.',
  );
}

export async function verifyOtp(
  phone: string,
  code: string,
  _verificationId: string,
): Promise<VerifyOtpResult> {
  if (DEV_AUTH_MODE) {
    await delay(500);
    if (code !== DEV_OTP) {
      throw new Error('Incorrect OTP. Try 123456 in dev mode.');
    }
    return {
      profile: makeMockProfile(phone),
      needsProfile: true,
    };
  }
  throw new Error(
    'Real Firebase phone auth is not wired up yet. ' +
      'Implement via @react-native-firebase/auth in a dev-client build.',
  );
}

export async function updateProfile(
  current: UserProfile,
  updates: { name: string; photoUri: string | null },
): Promise<UserProfile> {
  await delay(300);
  return {
    ...current,
    name: updates.name.trim(),
    photoUri: updates.photoUri,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const DEV_AUTH = {
  enabled: DEV_AUTH_MODE,
  otp: DEV_OTP,
};
