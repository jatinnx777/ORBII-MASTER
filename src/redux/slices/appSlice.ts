import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { GeoPoint } from '@/types';

// SafeMode is a live-journey guard. User tells the app "I'll reach X by Y
// time". The app shares a live-location link with a trusted contact and
// auto-fires SOS if the user doesn't confirm safe arrival by the ETA.
type SafeJourney = {
  // Shown to the user and sent to the trusted contact.
  label: string;
  // Expected safe-arrival timestamp (ms epoch).
  etaMs: number;
  // Contact id (from profile.emergencyContacts). Null = no contact selected
  // yet, which disables the trusted-contact ping but keeps the guard active.
  trustedContactId: string | null;
  // Optional destination for display. Not required to start a journey.
  destination?: GeoPoint;
  // When the journey was started.
  startedAtMs: number;
};

type AppState = {
  onboarded: boolean;
  isOnline: boolean;
  // Buzz the phone when an SOS broadcast lands within 2 km. On by default.
  alertVibration: boolean;
  pushEnabled: boolean;
  // Helper Mode: the user volunteers as a nearby helper. Their location is
  // periodically uploaded to helpers_live so others' SOS can find them.
  // Off by default — opt-in only.
  helperMode: boolean;
  hydrated: boolean;
  // Safe Mode toggle (live journey guard). Null = not active.
  safeJourney: SafeJourney | null;
  // Privacy policy + terms acceptance (timestamp ms when accepted, null = not
  // accepted). Required before signup. Play Store compliance.
  policyAcceptedAt: number | null;
};

const initialState: AppState = {
  onboarded: false,
  isOnline: true,
  alertVibration: true,
  pushEnabled: false,
  helperMode: false,
  hydrated: false,
  safeJourney: null,
  policyAcceptedAt: null,
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    appHydrated(
      state,
      action: PayloadAction<Partial<Omit<AppState, 'hydrated'>>>,
    ) {
      return { ...state, ...action.payload, hydrated: true };
    },
    onboardingCompleted(state) {
      state.onboarded = true;
    },
    connectionChanged(state, action: PayloadAction<boolean>) {
      state.isOnline = action.payload;
    },
    alertVibrationToggled(state, action: PayloadAction<boolean>) {
      state.alertVibration = action.payload;
    },
    pushEnabledSet(state, action: PayloadAction<boolean>) {
      state.pushEnabled = action.payload;
    },
    helperModeSet(state, action: PayloadAction<boolean>) {
      state.helperMode = action.payload;
    },
    safeJourneyStarted(
      state,
      action: PayloadAction<{
        label: string;
        etaMs: number;
        trustedContactId: string | null;
        destination?: GeoPoint;
      }>,
    ) {
      state.safeJourney = {
        ...action.payload,
        startedAtMs: Date.now(),
      };
    },
    safeJourneyEnded(state) {
      state.safeJourney = null;
    },
    policyAccepted(state) {
      state.policyAcceptedAt = Date.now();
    },
    policyRevoked(state) {
      state.policyAcceptedAt = null;
    },
  },
});

export const {
  appHydrated,
  onboardingCompleted,
  connectionChanged,
  alertVibrationToggled,
  pushEnabledSet,
  helperModeSet,
  safeJourneyStarted,
  safeJourneyEnded,
  policyAccepted,
  policyRevoked,
} = appSlice.actions;

export default appSlice.reducer;
