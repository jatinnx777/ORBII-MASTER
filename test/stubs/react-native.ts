// Minimal stand-in for react-native under vitest.
//
// React Native ships Flow-typed source ("import typeof ..."), which Rollup
// cannot parse, so importing any module that transitively reaches it blows up
// the whole test file. The functions under test here are pure and never touch
// these APIs; they are only present because their module imports Platform or
// NativeModules at the top level.
export const Platform = { OS: 'android', select: (o: Record<string, unknown>) => o.android };
export const NativeModules: Record<string, unknown> = {};
export const DeviceEventEmitter = {
  addListener(_e: string, _cb: (...args: unknown[]) => void) {
    return { remove: () => undefined };
  },
  emit(_e: string, ..._args: unknown[]) {},
};
export const Share = { share: async () => ({ action: 'dismissedAction' }), sharedAction: 'sharedAction' };
export default { Platform, NativeModules, Share, DeviceEventEmitter };
