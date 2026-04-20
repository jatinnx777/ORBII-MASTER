import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { CommunityAlert } from '@/types';

type CommunityState = {
  alerts: CommunityAlert[];
  lastFetchedAt: number | null;
  isLoading: boolean;
  error: string | null;
  // The alert this user is currently responding to (if any).
  respondingToId: string | null;
};

const initialState: CommunityState = {
  alerts: [],
  lastFetchedAt: null,
  isLoading: false,
  error: null,
  respondingToId: null,
};

const communitySlice = createSlice({
  name: 'community',
  initialState,
  reducers: {
    alertsLoadStarted(state) {
      state.isLoading = true;
      state.error = null;
    },
    // MERGE rather than replace. The DB query (`listNearbyAlerts`) is a
    // best-effort backfill; if our Supabase project doesn't have `sos_events`
    // populated, it returns []. The realtime broadcast is the actual source
    // of truth — a wholesale replace here was wiping live alerts ~1s after
    // they appeared, which is the "pops up then disappears" bug.
    alertsLoaded(state, action: PayloadAction<CommunityAlert[]>) {
      const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
      const merged = new Map<string, CommunityAlert>();
      // Keep currently visible alerts that are still fresh.
      for (const a of state.alerts) {
        if (a.createdAt >= fifteenMinAgo) merged.set(a.id, a);
      }
      // Layer DB results on top — they fill in things we missed.
      for (const a of action.payload) {
        if (a.createdAt >= fifteenMinAgo) merged.set(a.id, a);
      }
      state.alerts = Array.from(merged.values()).sort(
        (a, b) => a.distanceMeters - b.distanceMeters,
      );
      state.isLoading = false;
      state.lastFetchedAt = Date.now();
      state.error = null;
    },
    // A live broadcast arrived for an alert that passes the radius filter.
    // Insert-or-update by id so duplicates (poll + broadcast) don't stack.
    alertReceived(state, action: PayloadAction<CommunityAlert>) {
      const idx = state.alerts.findIndex((a) => a.id === action.payload.id);
      if (idx === -1) {
        state.alerts = [action.payload, ...state.alerts].sort(
          (a, b) => a.distanceMeters - b.distanceMeters,
        );
      } else {
        state.alerts[idx] = action.payload;
      }
    },
    alertDismissed(state, action: PayloadAction<string>) {
      state.alerts = state.alerts.filter((a) => a.id !== action.payload);
    },
    alertsLoadFailed(state, action: PayloadAction<string>) {
      state.isLoading = false;
      state.error = action.payload;
    },
    respondingStarted(state, action: PayloadAction<string>) {
      state.respondingToId = action.payload;
    },
    respondingEnded(state) {
      state.respondingToId = null;
    },
  },
});

export const {
  alertsLoadStarted,
  alertsLoaded,
  alertReceived,
  alertDismissed,
  alertsLoadFailed,
  respondingStarted,
  respondingEnded,
} = communitySlice.actions;

export default communitySlice.reducer;
