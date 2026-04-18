import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export type ConnectionState = {
  isConnected: boolean;
  type: string;
};

export function subscribeConnection(listener: (state: ConnectionState) => void) {
  return NetInfo.addEventListener((s: NetInfoState) => {
    listener({
      isConnected: !!s.isConnected && s.isInternetReachable !== false,
      type: s.type,
    });
  });
}

export async function getConnection(): Promise<ConnectionState> {
  const s = await NetInfo.fetch();
  return {
    isConnected: !!s.isConnected && s.isInternetReachable !== false,
    type: s.type,
  };
}
