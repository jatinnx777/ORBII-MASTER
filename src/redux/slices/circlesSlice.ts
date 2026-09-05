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
  // A refresh is in flight over data that is ALREADY on screen. This is not a
  // loading state and no screen should gate on it: it drives the 2px sync line
  // and nothing else. The distinction matters because `status: 'loading'`
  // means "there is nothing to show yet", and once the cache hydrates that is
  // almost never true again.
  revalidating: boolean;
  error: string | null;
  // True when the server returned a "table does not exist" error, the user
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
  revalidating: false,
  error: null,
  setupNeeded: false,
};

const circlesSlice = createSlice({
  name: 'circles',
  initialState,
  reducers: {
    // Cache restore, before the network is touched. Everything here came off
    // the device, so it is instant and may be out of date, which is the trade
    // the whole pattern is built on.
    circlesHydrated(
      state,
      action: PayloadAction<{
        circles: Circle[];
        activeCircleId: string | null;
        membersByCircle?: Record<string, CircleMember[]>;
      }>,
    ) {
      state.circles = action.payload.circles;
      state.activeCircleId = action.payload.activeCircleId;
      if (action.payload.membersByCircle) {
        state.membersByCircle = action.payload.membersByCircle;
      }
      // Only claim ready if there is something to show. Hydrating from an
      // empty cache and calling it ready is how a first-run user gets a blank
      // screen with no skeleton and no spinner.
      state.status = action.payload.circles.length > 0 ? 'ready' : 'idle';
    },
    // Deliberately does NOT force 'loading' when data is already on screen.
    // Every caller of this used to blank the UI on a background refresh; now
    // the same call means "show the sync line" once the cache has hydrated,
    // and only means "show a skeleton" on a genuinely cold start. Making the
    // action smart rather than adding a second one means no caller can get
    // this wrong by forgetting which to use.
    circlesLoading(state) {
      if (state.circles.length > 0) {
        state.revalidating = true;
      } else {
        state.status = 'loading';
      }
      state.error = null;
    },
    circlesSetupNeeded(state) {
      state.status = 'errored';
      state.revalidating = false;
      state.setupNeeded = true;
      state.error = null;
    },
    circlesLoaded(state, action: PayloadAction<Circle[]>) {
      state.circles = action.payload;
      state.status = 'ready';
      state.revalidating = false;
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
      state.revalidating = false;
      state.error = action.payload;
      // A failed refresh over cached data is not an error state. The user is
      // looking at their circles right now; blanking them to show a message
      // about a network that will probably be back in four seconds is worse
      // than saying nothing. Only a failure with nothing to fall back on
      // earns the error screen.
      if (state.circles.length === 0) state.status = 'errored';
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
