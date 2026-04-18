import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type {
  GeoPoint,
  LocationPermissionStatus,
  SOSRecord,
} from '@/types';

type SOSState = {
  currentLocation: GeoPoint | null;
  locationPermission: LocationPermissionStatus;
  locationError: string | null;
  helpersNearby: number;
  activeSOS: SOSRecord | null;
  dispatching: boolean;
  dispatchError: string | null;
};

const initialState: SOSState = {
  currentLocation: null,
  locationPermission: 'unknown',
  locationError: null,
  helpersNearby: 0,
  activeSOS: null,
  dispatching: false,
  dispatchError: null,
};

const sosSlice = createSlice({
  name: 'sos',
  initialState,
  reducers: {
    locationPermissionChanged(
      state,
      action: PayloadAction<LocationPermissionStatus>,
    ) {
      state.locationPermission = action.payload;
      if (action.payload === 'granted') state.locationError = null;
    },
    locationUpdated(state, action: PayloadAction<GeoPoint>) {
      state.currentLocation = action.payload;
      state.locationError = null;
    },
    locationErrored(state, action: PayloadAction<string>) {
      state.locationError = action.payload;
    },
    helpersNearbyUpdated(state, action: PayloadAction<number>) {
      state.helpersNearby = action.payload;
    },
    sosDispatchStarted(state) {
      state.dispatching = true;
      state.dispatchError = null;
    },
    sosDispatchSucceeded(state, action: PayloadAction<SOSRecord>) {
      state.dispatching = false;
      state.activeSOS = action.payload;
    },
    sosDispatchFailed(state, action: PayloadAction<string>) {
      state.dispatching = false;
      state.dispatchError = action.payload;
    },
    sosResolved(
      state,
      action: PayloadAction<{ responderId: string | null; rating: number | null }>,
    ) {
      if (state.activeSOS) {
        const responder =
          state.activeSOS.helpers.find((h) => h.id === action.payload.responderId) ||
          null;
        state.activeSOS = {
          ...state.activeSOS,
          status: 'resolved',
          resolvedAt: Date.now(),
          responder,
          rating: action.payload.rating,
          responseTime:
            Math.round((Date.now() - state.activeSOS.timestamp) / 1000),
        };
      }
    },
    sosCancelled(state) {
      if (state.activeSOS) {
        state.activeSOS = {
          ...state.activeSOS,
          status: 'cancelled',
          resolvedAt: Date.now(),
        };
      }
    },
    sosCleared(state) {
      state.activeSOS = null;
      state.dispatchError = null;
    },
  },
});

export const {
  locationPermissionChanged,
  locationUpdated,
  locationErrored,
  helpersNearbyUpdated,
  sosDispatchStarted,
  sosDispatchSucceeded,
  sosDispatchFailed,
  sosResolved,
  sosCancelled,
  sosCleared,
} = sosSlice.actions;

export default sosSlice.reducer;
