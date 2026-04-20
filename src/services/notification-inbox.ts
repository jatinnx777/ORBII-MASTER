import { getItem, setItem, storageKeys } from './storage';

export type NotificationEntry = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  kind: 'sos' | 'helper' | 'system';
};

const MAX_ENTRIES = 100;

export async function listNotifications(): Promise<NotificationEntry[]> {
  const list = await getItem<NotificationEntry[]>(storageKeys.notifications);
  return list ?? [];
}

export async function addNotification(
  entry: Omit<NotificationEntry, 'id' | 'createdAt' | 'read'>,
): Promise<NotificationEntry> {
  const full: NotificationEntry = {
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    read: false,
    ...entry,
  };
  const current = await listNotifications();
  const next = [full, ...current].slice(0, MAX_ENTRIES);
  await setItem(storageKeys.notifications, next);
  return full;
}

export async function markAllRead(): Promise<void> {
  const current = await listNotifications();
  const next = current.map((n) => ({ ...n, read: true }));
  await setItem(storageKeys.notifications, next);
}

export async function clearNotifications(): Promise<void> {
  await setItem(storageKeys.notifications, []);
}

export async function unreadCount(): Promise<number> {
  const list = await listNotifications();
  return list.filter((n) => !n.read).length;
}
