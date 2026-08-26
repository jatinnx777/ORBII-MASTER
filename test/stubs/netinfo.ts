// NetInfo ships Flow-typed source that esbuild cannot parse, so it is stubbed
// rather than transformed. Nothing here needs real connectivity: the tests that
// touch it are about constant resolution and pruning, not about the radio.
type State = { isConnected: boolean; isInternetReachable: boolean | null; type: string };

const OFFLINE: State = { isConnected: false, isInternetReachable: false, type: 'none' };

export default {
  addEventListener(_cb: (s: State) => void) {
    return () => undefined;
  },
  async fetch(): Promise<State> {
    return OFFLINE;
  },
};
export type NetInfoState = State;
