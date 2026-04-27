import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type {
  AuthStatus,
  EmergencyContact,
  Friend,
  IdDocumentKind,
  IdVerificationStatus,
  UserProfile,
} from '@/types';

type UserState = {
  status: AuthStatus;
  profile: UserProfile | null;
  error: string | null;
};

const initialState: UserState = {
  status: 'idle',
  profile: null,
  error: null,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    signInStarted(state) {
      state.status = 'signing_in';
      state.error = null;
    },
    signInSucceeded(
      state,
      action: PayloadAction<{ profile: UserProfile; needsProfile: boolean }>,
    ) {
      state.profile = action.payload.profile;
      state.status = action.payload.needsProfile
        ? 'needs_profile'
        : 'authenticated';
    },
    signInFailed(state, action: PayloadAction<{ error: string }>) {
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
    usernameSet(state, action: PayloadAction<string>) {
      if (state.profile) state.profile.username = action.payload;
    },
    friendAdded(state, action: PayloadAction<Friend>) {
      if (!state.profile) return;
      const list = state.profile.friends ?? [];
      const exists = list.some((f) => f.username === action.payload.username);
      if (exists) return;
      state.profile.friends = [action.payload, ...list];
      // Server-side mirror is fire-and-forget — no need to import here, the
      // persist subscriber pushes the whole profile up on every change.
    },
    friendRemoved(state, action: PayloadAction<string>) {
      if (!state.profile) return;
      state.profile.friends = (state.profile.friends ?? []).filter(
        (f) => f.username !== action.payload,
      );
    },
    premiumUpgraded(state) {
      if (state.profile) state.profile.isPremium = true;
    },
    helperModeToggled(state, action: PayloadAction<boolean>) {
      if (state.profile) state.profile.isHelper = action.payload;
    },
    userIdSubmitted(
      state,
      action: PayloadAction<{
        kind: IdDocumentKind;
        number: string;
        photoUri: string;
      }>,
    ) {
      if (state.profile) {
        state.profile.idKind = action.payload.kind;
        state.profile.idNumber = action.payload.number;
        state.profile.idPhotoUri = action.payload.photoUri;
        state.profile.idVerification = 'pending';
      }
    },
    userIdVerificationChanged(
      state,
      action: PayloadAction<IdVerificationStatus>,
    ) {
      if (state.profile) state.profile.idVerification = action.payload;
    },
    profileHydrated(state, action: PayloadAction<UserProfile>) {
      state.profile = action.payload;
      state.status = 'authenticated';
    },
    signedOut() {
      return initialState;
    },
    errorCleared(state) {
      state.error = null;
      if (state.status === 'error') {
        state.status = 'idle';
      }
    },
  },
});

export const {
  signInStarted,
  signInSucceeded,
  signInFailed,
  profileUpdated,
  contactAdded,
  contactUpdated,
  contactRemoved,
  usernameSet,
  friendAdded,
  friendRemoved,
  premiumUpgraded,
  helperModeToggled,
  userIdSubmitted,
  userIdVerificationChanged,
  profileHydrated,
  signedOut,
  errorCleared,
} = userSlice.actions;

export default userSlice.reducer;
