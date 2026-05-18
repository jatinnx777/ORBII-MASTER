import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Circle, CircleInvite, CircleMember } from '@/services/circles';

// Circles slice. The slice mirrors the server (Supabase) and is hydrated
// on app start by `circlesBootstrap`. Selectors derived from it back the
// Home circle-selector dropdown, the Circles tab, and the safety logic
// that scopes "who can see my live location."

type CirclesState = {
  // All circles the current user belongs to.
  circles: Circle[];
  // Members per circle. Keyed by circleId so the Circles screen can render
  // immediately without re-fetching when switching between circles.
  membersByCircle: Record<string, CircleMember[]>;
  // Pending invites the current user has been sent.
  incomingInvites: CircleInvite[];
  // The circle currently focused in the Home header dropdown. null = "All
  // circles" (default behaviour for a brand-new user).
  activeCircleId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'errored';
  error: string | null;
  // True when the server returned a "table does not exist" error — the user
  // needs to paste sql/09_circles.sql into Supabase. The UI shows a clear
  // setup banner in this state instead of a generic error.
  setupNeeded: boolean;
};

const initialState: CirclesState = {
  circles: [],
  membersByCircle: {},
  incomingInvites: [],
  activeCircleId: null,
  status: 'idle',
  error: null,
  setupNeeded: false,
};

const circlesSlice = createSlice({
  name: 'circles',
  initialState,
  reducers: {
    circlesHydrated(
      state,
      action: PayloadAction<{ circles: Circle[]; activeCircleId: string | null }>,
    ) {
      state.circles = action.payload.circles;
      state.activeCircleId = action.payload.activeCircleId;
      state.status = 'ready';
    },
    circlesLoading(state) {
      state.status = 'loading';
      state.error = null;
    },
    circlesSetupNeeded(state) {
      state.status = 'errored';
      state.setupNeeded = true;
      state.error = null;
    },
    circlesLoaded(state, action: PayloadAction<Circle[]>) {
      state.circles = action.payload;
      state.status = 'ready';
      state.error = null;
      state.setupNeeded = false;
      // Keep activeCircleId valid: if the active circle disappeared (we
      // left it elsewhere, or it was deleted server-side), fall back to
      // the user's default circle, then the first one, then null.
      const idsNow = new Set(action.payload.map((c) => c.id));
      if (state.activeCircleId && !idsNow.has(state.activeCircleId)) {
        const def = action.payload.find((c) => c.isDefault);
        state.activeCircleId = def?.id ?? action.payload[0]?.id ?? null;
      } else if (!state.activeCircleId && action.payload.length > 0) {
        const def = action.payload.find((c) => c.isDefault);
        state.activeCircleId = def?.id ?? action.payload[0].id;
      }
    },
    circlesErrored(state, action: PayloadAction<string>) {
      state.status = 'errored';
      state.error = action.payload;
    },
    circleAdded(state, action: PayloadAction<Circle>) {
      state.circles = [action.payload, ...state.circles.filter((c) => c.id !== action.payload.id)];
      if (!state.activeCircleId) state.activeCircleId = action.payload.id;
    },
    circleUpdated(state, action: PayloadAction<Circle>) {
      state.circles = state.circles.map((c) =>
        c.id === action.payload.id ? action.payload : c,
      );
    },
    circleRemoved(state, action: PayloadAction<string>) {
      state.circles = state.circles.filter((c) => c.id !== action.payload);
      delete state.membersByCircle[action.payload];
      if (state.activeCircleId === action.payload) {
        const def = state.circles.find((c) => c.isDefault);
        state.activeCircleId = def?.id ?? state.circles[0]?.id ?? null;
      }
    },
    activeCircleChanged(state, action: PayloadAction<string | null>) {
      state.activeCircleId = action.payload;
    },
    membersLoaded(
      state,
      action: PayloadAction<{ circleId: string; members: CircleMember[] }>,
    ) {
      state.membersByCircle[action.payload.circleId] = action.payload.members;
    },
    incomingInvitesLoaded(state, action: PayloadAction<CircleInvite[]>) {
      state.incomingInvites = action.payload;
    },
    inviteResolved(state, action: PayloadAction<string>) {
      state.incomingInvites = state.incomingInvites.filter(
        (i) => i.id !== action.payload,
      );
    },
    circlesReset() {
      return initialState;
    },
  },
});

export const {
  circlesHydrated,
  circlesLoading,
  circlesSetupNeeded,
  circlesLoaded,
  circlesErrored,
  circleAdded,
  circleUpdated,
  circleRemoved,
  activeCircleChanged,
  membersLoaded,
  incomingInvitesLoaded,
  inviteResolved,
  circlesReset,
} = circlesSlice.actions;

export default circlesSlice.reducer;
