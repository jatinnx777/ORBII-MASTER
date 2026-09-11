import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { EmptyState, ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  clearNotifications,
  listNotifications,
  markAllRead,
  type NotificationEntry,
} from '@/services/notification-inbox';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { acceptInvite, declineInvite, type CircleInvite } from '@/services/circles';
import { inviteResolved } from '@/redux/slices/circlesSlice';
import { refreshCircles, setActiveCircle } from '@/services/circles-bootstrap';
import {
  acknowledgeZone,
  declineZoneOnMe,
  loadZoneRequests,
  type ZoneRequest,
} from '@/services/geofence';

// One inbox. It was split in two so a social like never sat next to an SOS,
// and with the community feature gone the second half has nothing to hold, so
// the segmented control goes with it rather than sitting there showing an empty
// state forever.

type Icon = { name: keyof typeof Ionicons.glyphMap; color: string; bg: string };
type ActivityItem = { id: string; title: string; body: string; createdAt: number; icon: Icon };

export function NotificationsScreen() {
  const dispatch = useAppDispatch();
  const navigation = useNavigation<{ navigate: (r: string) => void }>();
  const invites = useAppSelector((s) => s.circles.incomingInvites);
  const uid = useAppSelector((s) => s.user.profile?.uid);

  const [local, setLocal] = useState<NotificationEntry[]>([]);
  const [zoneReqs, setZoneReqs] = useState<ZoneRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [l, z] = await Promise.all([
      listNotifications(),
      uid ? loadZoneRequests(uid) : Promise.resolve([]),
    ]);
    setLocal(l);
    setZoneReqs(z);
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    load();
    markAllRead().catch(() => undefined);
  }, [load]);

  const handleClear = async () => {
    await clearNotifications();
    setLocal([]);
  };

  const onAcceptInvite = async (invite: CircleInvite) => {
    try {
      await acceptInvite(invite);
      dispatch(inviteResolved(invite.id));
      await refreshCircles();
      await setActiveCircle(invite.circleId);
    } catch {
      /* surfaced on Circles if it persists */
    }
  };
  const onDeclineInvite = async (invite: CircleInvite) => {
    try {
      await declineInvite(invite.id);
      dispatch(inviteResolved(invite.id));
    } catch {
      /* ignore */
    }
  };
  const onKeepZone = async (z: ZoneRequest) => {
    setZoneReqs((cur) => cur.filter((r) => r.id !== z.id));
    await acknowledgeZone(z.id);
  };
  const onDeclineZone = async (z: ZoneRequest) => {
    setZoneReqs((cur) => cur.filter((r) => r.id !== z.id));
    await declineZoneOnMe(z.id);
  };

  const activity = local.map(localToActivity).sort((a, b) => b.createdAt - a.createdAt);
  const requestCount = invites.length + zoneReqs.length;
  const youEmpty = requestCount === 0 && activity.length === 0;

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        {local.length > 0 ? (
          <Pressable onPress={handleClear} hitSlop={8}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        {(
          youEmpty && !loading ? (
            <EmptyState
              icon="notifications-off-outline"
              title="You're all caught up"
              body="SOS alerts, circle requests, and safe-zone activity show up here."
            />
          ) : (
            <>
              {requestCount > 0 ? (
                <Section
                  title="Requests"
                  hint="Invitations and safe-zone requests that need your answer."
                >
                  {invites.map((invite) => (
                    <RequestCard
                      key={invite.id}
                      icon={{ name: 'people', color: colors.lavenderDeep, bg: colors.lavenderSoft }}
                      title="Circle invitation"
                      body="Someone invited you to their safety circle."
                      onDecline={() => onDeclineInvite(invite)}
                      onAccept={() => onAcceptInvite(invite)}
                      acceptLabel="Accept"
                    />
                  ))}
                  {zoneReqs.map((z) => (
                    <RequestCard
                      key={z.id}
                      icon={{ name: 'location', color: colors.brandDeep, bg: colors.brandSoft }}
                      title={`Safe zone: ${z.label}`}
                      body={`${z.ownerName ?? 'Someone'} wants your circle alerted if you leave ${z.label}${
                        z.activeFrom && z.activeTo
                          ? ` between ${fmtHM(z.activeFrom)} and ${fmtHM(z.activeTo)}`
                          : ''
                      }.`}
                      onDecline={() => onDeclineZone(z)}
                      onAccept={() => onKeepZone(z)}
                      acceptLabel="Keep"
                    />
                  ))}
                </Section>
              ) : null}

              {activity.length > 0 ? (
                <Section
                  title="Activity"
                  hint="SOS alerts, helpers, and safe-zone crossings."
                >
                  {groupByTime(activity).map((g) => (
                    <View key={g.label}>
                      <Text style={styles.timeLabel}>{g.label}</Text>
                      <View style={styles.groupCard}>
                        {g.items.map((item, idx) => (
                          <View key={item.id}>
                            {idx > 0 ? <View style={styles.rowDivider} /> : null}
                            <ActivityRow item={item} />
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </Section>
              ) : null}
            </>
          )
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionHint}>{hint}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function RequestCard({
  icon,
  title,
  body,
  onDecline,
  onAccept,
  acceptLabel,
}: {
  icon: Icon;
  title: string;
  body: string;
  onDecline: () => void;
  onAccept: () => void;
  acceptLabel: string;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.iconWrap, { backgroundColor: icon.bg }]}>
          <Ionicons name={icon.name} size={18} color={icon.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowBody}>{body}</Text>
        </View>
      </View>
      <View style={styles.cardBtns}>
        <Pressable onPress={onDecline} style={styles.declineBtn} hitSlop={6}>
          <Text style={styles.declineText}>Decline</Text>
        </Pressable>
        <Pressable onPress={onAccept} style={styles.acceptBtn} hitSlop={6}>
          <Text style={styles.acceptText}>{acceptLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ActivityRow({ item, onPress }: { item: ActivityItem; onPress?: () => void }) {
  const inner = (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: item.icon.bg }]}>
        <Ionicons name={item.icon.name} size={18} color={item.icon.color} />
      </View>
      <View style={styles.rowBodyWrap}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowBody} numberOfLines={2}>{item.body}</Text>
      </View>
      <Text style={styles.rowTime}>{relativeTime(item.createdAt)}</Text>
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
      {inner}
    </Pressable>
  );
}

function iconForKind(kind: NotificationEntry['kind']): Icon {
  switch (kind) {
    case 'sos':
      return { name: 'alert-circle', color: colors.coral, bg: colors.coralSoft };
    case 'helper':
      return { name: 'people-circle', color: colors.lavenderDeep, bg: colors.lavenderSoft };
    default:
      return { name: 'notifications', color: colors.textSecondary, bg: colors.cream };
  }
}

function localToActivity(e: NotificationEntry): ActivityItem {
  return { id: e.id, title: e.title, body: e.body, createdAt: e.createdAt, icon: iconForKind(e.kind) };
}

function groupByTime(items: ActivityItem[]): { label: string; items: ActivityItem[] }[] {
  const day = 86_400_000;
  const now = Date.now();
  const buckets: Record<string, ActivityItem[]> = { Today: [], 'This week': [], Earlier: [] };
  for (const it of items) {
    const age = now - it.createdAt;
    const key = age < day ? 'Today' : age < 7 * day ? 'This week' : 'Earlier';
    buckets[key].push(it);
  }
  return (['Today', 'This week', 'Earlier'] as const)
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ label: k, items: buckets[k] }));
}

function fmtHM(s: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return s;
  let h = Number(m[1]);
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${m[2]} ${ap}`;
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { fontFamily: fontFamilies.poppinsBold, fontSize: 28, color: colors.textPrimary },
  clear: { ...typography.bodyMedium, color: colors.coral },

  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  section: { marginTop: spacing.md },
  sectionTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary },
  sectionHint: { ...typography.caption, color: colors.textMuted, marginTop: 1, marginBottom: spacing.sm },
  sectionBody: { gap: spacing.sm },
  timeLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: 4,
  },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, ...shadows.card },
  cardTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  cardBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },

  groupCard: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.md, ...shadows.card },
  rowDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 54 },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, alignItems: 'center' },
  rowBodyWrap: { flex: 1, gap: 2 },
  iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  rowBody: { ...typography.caption, color: colors.textSecondary, lineHeight: 17 },
  rowTime: { ...typography.caption, color: colors.textMuted, alignSelf: 'flex-start', marginTop: 2 },

  declineBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.cream },
  declineText: { ...typography.label, color: colors.textSecondary },
  acceptBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.peach },
  acceptText: { ...typography.label, color: colors.textPrimary },
});
