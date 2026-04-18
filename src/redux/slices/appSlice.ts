import { createSlice, PayloadAction } from '@reduxjs/toolkit';

type AppState = {
  onboarded: boolean;
  isOnline: boolean;
  voiceDetection: boolean;
  pushEnabled: boolean;
  hydrated: boolean;
};

const initialState: AppState = {
  onboarded: false,
  isOnline: true,
  voiceDetection: false,
  pushEnabled: false,
  hydrated: false,
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
    voiceDetectionToggled(state, action: PayloadAction<boolean>) {
      state.voiceDetection = action.payload;
    },
    pushEnabledSet(state, action: PayloadAction<boolean>) {
      state.pushEnabled = action.payload;
    },
  },
});

export const {
  appHydrated,
  onboardingCompleted,
  connectionChanged,
  voiceDetectionToggled,
  pushEnabledSet,
} = appSlice.actions;

export default appSlice.reducer;
