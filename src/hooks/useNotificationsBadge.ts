import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { unreadCount } from '@/services/notification-inbox';

// Lightweight unread-bell badge. Polls on focus + a soft 10s interval
// so the dot stays current without subscribing to a real change stream.
// (The inbox today is AsyncStorage-backed — a change stream would be
// over-engineering until we move it server-side.)
export function useNotificationsBadge(): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const n = await unreadCount();
      setCount(n);
    } catch {
      // ignore — keep last known value
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const id = setInterval(refresh, 10_000);
      return () => clearInterval(id);
    }, [refresh]),
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return count;
}
