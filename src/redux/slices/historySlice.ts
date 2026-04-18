import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { SOSRecord } from '@/types';

type HistoryState = {
  records: SOSRecord[];
  hydrated: boolean;
};

const initialState: HistoryState = {
  records: [],
  hydrated: false,
};

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    historyHydrated(state, action: PayloadAction<SOSRecord[]>) {
      state.records = [...action.payload].sort((a, b) => b.timestamp - a.timestamp);
      state.hydrated = true;
    },
    historyRecordAdded(state, action: PayloadAction<SOSRecord>) {
      const existing = state.records.findIndex((r) => r.id === action.payload.id);
      if (existing >= 0) state.records[existing] = action.payload;
      else state.records.unshift(action.payload);
    },
    historyCleared(state) {
      state.records = [];
    },
  },
});

export const { historyHydrated, historyRecordAdded, historyCleared } =
  historySlice.actions;

export default historySlice.reducer;
