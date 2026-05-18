import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import userReducer from './slices/userSlice';
import sosReducer from './slices/sosSlice';
import historyReducer from './slices/historySlice';
import helperReducer from './slices/helperSlice';
import appReducer from './slices/appSlice';
import communityReducer from './slices/communitySlice';
import safetyModesReducer from './slices/safetyModesSlice';
import circlesReducer from './slices/circlesSlice';

export const store = configureStore({
  reducer: {
    user: userReducer,
    sos: sosReducer,
    history: historyReducer,
    helper: helperReducer,
    app: appReducer,
    community: communityReducer,
    safetyModes: safetyModesReducer,
    circles: circlesReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
