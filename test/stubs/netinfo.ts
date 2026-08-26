// NetInfo ships Flow-typed source that esbuild cannot parse, so it is stubbed.
// Connectivity is settable, because the vault's whole job is what it does when
// the network comes and goes.
type State = { isConnected: boolean; isInternetReachable: boolean | null; type: string };

let current: State = { isConnected: false, isInternetReachable: false, type: 'none' };
const listeners = new Set<(s: State) => void>();

export function __setConnected(connected: boolean): void {
  current = connected
    ? { isConnected: true, isInternetReachable: true, type: 'wifi' }
    : { isConnected: false, isInternetReachable: false, type: 'none' };
  for (const l of listeners) l(current);
}

export default {
  addEventListener(cb: (s: State) => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async fetch(): Promise<State> {
    return current;
  },
};
export type NetInfoState = State;
