import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AuthStatus, EmergencyContact, UserProfile } from '@/types';

type UserState = {
  status: AuthStatus;
  pendingPhone: string | null;
  verificationId: string | null;
  profile: UserProfile | null;
  error: string | null;
};

const initialState: UserState = {
  status: 'idle',
  pendingPhone: null,
  verificationId: null,
  profile: null,
  error: null,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    otpSendStarted(state, action: PayloadAction<{ phone: string }>) {
      state.status = 'sending_otp';
      state.pendingPhone = action.payload.phone;
      state.error = null;
    },
    otpSendSucceeded(state, action: PayloadAction<{ verificationId: string }>) {
      state.status = 'otp_sent';
      state.verificationId = action.payload.verificationId;
    },
    otpSendFailed(state, action: PayloadAction<{ error: string }>) {
      state.status = 'error';
      state.error = action.payload.error;
    },
    otpVerifyStarted(state) {
      state.status = 'verifying_otp';
      state.error = null;
    },
    otpVerifySucceeded(
      state,
      action: PayloadAction<{ profile: UserProfile; needsProfile: boolean }>,
    ) {
      state.profile = action.payload.profile;
      state.status = action.payload.needsProfile
        ? 'needs_profile'
        : 'authenticated';
    },
    otpVerifyFailed(state, action: PayloadAction<{ error: string }>) {
      state.status = 'error';
      state.error = action.payload.error;
    },
    profileUpdated(state, action: PayloadAction<UserProfile>) {
      state.profile = action.payload;
      state.status = 'authenticated';
    },
    contactAdded(state, action: PayloadAction<EmergencyContact>) {
      if (state.profile) {
        state.profile.emergencyContacts = [
          ...state.profile.emergencyContacts,
          action.payload,
        ];
      }
    },
    contactUpdated(state, action: PayloadAction<EmergencyContact>) {
      if (state.profile) {
        state.profile.emergencyContacts = state.profile.emergencyContacts.map(
          (c) => (c.id === action.payload.id ? action.payload : c),
        );
      }
    },
    contactRemoved(state, action: PayloadAction<string>) {
      if (state.profile) {
        state.profile.emergencyContacts = state.profile.emergencyContacts.filter(
          (c) => c.id !== action.payload,
        );
      }
    },
    premiumUpgraded(state) {
      if (state.profile) state.profile.isPremium = true;
    },
    helperModeToggled(state, action: PayloadAction<boolean>) {
      if (state.profile) state.profile.isHelper = action.payload;
    },
    signedOut() {
      return initialState;
    },
    errorCleared(state) {
      state.error = null;
      if (state.status === 'error') {
        state.status = state.verificationId ? 'otp_sent' : 'idle';
      }
    },
  },
});

export const {
  otpSendStarted,
  otpSendSucceeded,
  otpSendFailed,
  otpVerifyStarted,
  otpVerifySucceeded,
  otpVerifyFailed,
  profileUpdated,
  contactAdded,
  contactUpdated,
  contactRemoved,
  premiumUpgraded,
  helperModeToggled,
  signedOut,
  errorCleared,
} = userSlice.actions;

export default userSlice.reducer;
