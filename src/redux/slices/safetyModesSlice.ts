import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { GeoPoint } from '@/types';

// Two protection modes that the user can toggle on before entering a
// risky situation. Each one persists across app restarts via the
// existing redux-persist subscription so a kill-and-relaunch doesn't
// silently end the session.
//
// Ghost Mode: silent trip protection. Captures destination + ride
// metadata, polls location, and watches for unusual stops / route
// deviations. Cab-specific fields (cab number, driver info) are
// Gold-tier only, handled at the UI layer, not gated here.
//
// Deadman Timer: countdown the user must cancel before expiry. If it
// expires, ORBII fires an auto-SOS to the user's circle.

export type GhostModeState = {
  active: boolean;
  startedAt: number | null;
  destinationLabel: string | null;
  destination: GeoPoint | null;
  origin: GeoPoint | null;
  cabNumber: string | null;
  driverName: string | null;
  note: string | null;
  // Last seen location, refreshed by the GhostMode active screen.
  lastSeen: { point: GeoPoint; at: number } | null;
  // Internal status the active screen renders.
  status: 'monitoring' | 'reached' | 'suspicious' | 'cancelled';
};

export type DeadmanTimerState = {
  active: boolean;
  startedAt: number | null;
  expiresAt: number | null;
  durationMs: number | null;
  recipients: string[]; // friend usernames
  note: string | null;
  shareLocation: boolean;
  // Notification id (returned by expo-notifications). Used to cancel
  // the scheduled local notification if the user disarms early.
  reminderNotificationId: string | null;
  expiryNotificationId: string | null;
};

type SafetyModesState = {
  ghost: GhostModeState;
  deadman: DeadmanTimerState;
};

const initialGhost: GhostModeState = {
  active: false,
  startedAt: null,
  destinationLabel: null,
  destination: null,
  origin: null,
  cabNumber: null,
  driverName: null,
  note: null,
  lastSeen: null,
  status: 'monitoring',
};

const initialDeadman: DeadmanTimerState = {
  active: false,
  startedAt: null,
  expiresAt: null,
  durationMs: null,
  recipients: [],
  note: null,
  shareLocation: true,
  reminderNotificationId: null,
  expiryNotificationId: null,
};

const initialState: SafetyModesState = {
  ghost: initialGhost,
  deadman: initialDeadman,
};

const slice = createSlice({
  name: 'safetyModes',
  initialState,
  reducers: {
    safetyModesHydrated(state, action: PayloadAction<Partial<SafetyModesState>>) {
      if (action.payload.ghost) state.ghost = action.payload.ghost;
      if (action.payload.deadman) state.deadman = action.payload.deadman;
    },

    // ----- Ghost Mode -----
    ghostStarted(state, action: PayloadAction<Omit<GhostModeState, 'active' | 'status' | 'lastSeen' | 'startedAt'>>) {
      state.ghost = {
        ...state.ghost,
        ...action.payload,
        active: true,
        startedAt: Date.now(),
        status: 'monitoring',
        lastSeen: null,
      };
    },
    ghostLocationPinged(
      state,
      action: PayloadAction<{ point: GeoPoint; at: number }>,
    ) {
      if (!state.ghost.active) return;
      state.ghost.lastSeen = action.payload;
    },
    ghostStatusChanged(
      state,
      action: PayloadAction<GhostModeState['status']>,
    ) {
      if (!state.ghost.active) return;
      state.ghost.status = action.payload;
    },
    ghostEnded(state) {
      state.ghost = initialGhost;
    },

    // ----- Deadman Timer -----
    deadmanArmed(
      state,
      action: PayloadAction<{
        durationMs: number;
        recipients: string[];
        note: string | null;
        shareLocation: boolean;
        reminderNotificationId: string | null;
        expiryNotificationId: string | null;
      }>,
    ) {
      const now = Date.now();
      state.deadman = {
        active: true,
        startedAt: now,
        expiresAt: now + action.payload.durationMs,
        durationMs: action.payload.durationMs,
        recipients: action.payload.recipients,
        note: action.payload.note,
        shareLocation: action.payload.shareLocation,
        reminderNotificationId: action.payload.reminderNotificationId,
        expiryNotificationId: action.payload.expiryNotificationId,
      };
    },
    deadmanExtended(state, action: PayloadAction<number>) {
      if (!state.deadman.active || state.deadman.expiresAt == null) return;
      state.deadman.expiresAt = state.deadman.expiresAt + action.payload;
      state.deadman.durationMs =
        (state.deadman.durationMs ?? 0) + action.payload;
    },
    deadmanDisarmed(state) {
      state.deadman = initialDeadman;
    },
  },
});

export const {
  safetyModesHydrated,
  ghostStarted,
  ghostLocationPinged,
  ghostStatusChanged,
  ghostEnded,
  deadmanArmed,
  deadmanExtended,
  deadmanDisarmed,
} = slice.actions;

export default slice.reducer;
