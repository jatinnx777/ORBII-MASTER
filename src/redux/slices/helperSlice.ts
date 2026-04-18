import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type {
  HelperJob,
  HelperJobStatus,
  HelperState,
  HelperVerificationStatus,
} from '@/types';

const initialState: HelperState = {
  mode: false,
  verification: 'unverified',
  rating: 4.9,
  totalJobs: 0,
  livesSaved: 0,
  balance: 0,
  pendingBalance: 0,
  currentJob: null,
  jobStatus: 'idle',
};

const helperSlice = createSlice({
  name: 'helper',
  initialState,
  reducers: {
    helperHydrated(_, action: PayloadAction<HelperState>) {
      return action.payload;
    },
    helperModeSet(state, action: PayloadAction<boolean>) {
      state.mode = action.payload;
      if (!action.payload) {
        state.currentJob = null;
        state.jobStatus = 'idle';
      }
    },
    helperVerificationSet(
      state,
      action: PayloadAction<HelperVerificationStatus>,
    ) {
      state.verification = action.payload;
    },
    incomingJobReceived(state, action: PayloadAction<HelperJob>) {
      state.currentJob = action.payload;
      state.jobStatus = 'incoming';
    },
    jobStatusChanged(state, action: PayloadAction<HelperJobStatus>) {
      state.jobStatus = action.payload;
      if (action.payload === 'declined') {
        state.currentJob = null;
        state.jobStatus = 'idle';
      }
    },
    jobCompleted(
      state,
      action: PayloadAction<{ reward: number; lifeSaved: boolean }>,
    ) {
      state.totalJobs += 1;
      if (action.payload.lifeSaved) state.livesSaved += 1;
      state.pendingBalance += action.payload.reward;
      state.currentJob = null;
      state.jobStatus = 'idle';
    },
    earningsWithdrawn(state, action: PayloadAction<number>) {
      state.pendingBalance = Math.max(0, state.pendingBalance - action.payload);
    },
    settledToBalance(state) {
      state.balance += state.pendingBalance;
      state.pendingBalance = 0;
    },
  },
});

export const {
  helperHydrated,
  helperModeSet,
  helperVerificationSet,
  incomingJobReceived,
  jobStatusChanged,
  jobCompleted,
  earningsWithdrawn,
  settledToBalance,
} = helperSlice.actions;

export default helperSlice.reducer;
