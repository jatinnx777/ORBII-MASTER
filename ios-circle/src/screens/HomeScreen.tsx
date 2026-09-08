import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, shadows, spacing, weight } from '../theme';
import { describeAlert, getCircleAlerts, type CircleAlert } from '../services/alerts';
import { signOut } from '../services/auth';

/**
 * The whole app in one screen: is anyone in my circle in trouble.
 *
 * WHEN NOTHING IS WRONG THIS SCREEN IS ALMOST EMPTY, on purpose. It is not a
 * dashboard and there is nothing to browse. Anything added here to make the
 * quiet state feel richer is something to scroll past on the one evening the
 * screen actually matters.
 *
 * It polls every 20 seconds while open, on top of push. A notification can be
 * silenced, swiped away half asleep, or killed with the app by an OEM battery
 * manager. A list you can open and check cannot.
 */
export function HomeScreen({
  onOpenAlert,
  onSignedOut,
}: {
  onOpenAlert: (alert: CircleAlert) => void;
  onSignedOut: () => void;
}) {
  const [alerts, setAlerts] = useState<CircleAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await getCircleAlerts();
    setAlerts(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const rows = await getCircleAlerts();
      if (alive) {
        setAlerts(rows);
        setLoading(false);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.mark}>ORBII</Text>
          <Text style={styles.title}>Circle</Text>
        </View>
        <Pressable
          onPress={() => {
            void signOut().then(onSignedOut);
          }}
          hitSlop={12}
        >
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandDeep} />
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(a) => a.sos_id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.brandDeep}
            />
          }
          ListEmptyComponent={
            <View style={styles.quiet}>
              <View style={styles.quietDot} />
              <Text style={styles.quietTitle}>Everyone is okay</Text>
              <Text style={styles.quietSub}>
                Nobody in your circles has raised an alarm. If someone does, this screen will
                show it and your phone will ring.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            // Nobody accepted is the state this app exists to surface, so it is
            // the loudest thing on the card rather than a detail inside it.
            const unanswered = item.responders === 0;
            return (
              <Pressable
                onPress={() => onOpenAlert(item)}
                style={({ pressed }) => [
                  styles.card,
                  unanswered && styles.cardUrgent,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={[styles.who, unanswered && styles.whoUrgent]}>{item.name}</Text>
                <Text style={[styles.when, unanswered && styles.whenUrgent]}>
                  {describeAlert(item)}
                </Text>
                {item.address ? (
                  <Text style={styles.where} numberOfLines={2}>
                    {item.address}
                  </Text>
                ) : null}
                <Text style={[styles.open, unanswered && styles.openUrgent]}>
                  Open and say what you are doing
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  mark: { fontSize: 11, fontWeight: weight.bold, letterSpacing: 2.6, color: colors.textMuted },
  title: {
    fontSize: 28,
    fontWeight: weight.bold,
    letterSpacing: -0.6,
    color: colors.textPrimary,
  },
  signOut: { fontSize: 14, color: colors.textSecondary, paddingTop: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, flexGrow: 1 },

  quiet: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: spacing.xxl },
  quietDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.sage,
    marginBottom: spacing.md,
  },
  quietTitle: { fontSize: 19, fontWeight: weight.semibold, color: colors.textPrimary },
  quietSub: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 300,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
    ...shadows.card,
  },
  cardUrgent: { backgroundColor: colors.coralDeep, borderColor: colors.coralDeep },
  pressed: { opacity: 0.92 },
  who: { fontSize: 19, fontWeight: weight.bold, color: colors.textPrimary },
  whoUrgent: { color: colors.textInverse },
  when: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  whenUrgent: { color: colors.textInverse, opacity: 0.95, fontWeight: weight.medium },
  where: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  open: {
    fontSize: 13,
    fontWeight: weight.semibold,
    color: colors.brandDeep,
    marginTop: spacing.sm,
  },
  openUrgent: { color: colors.textInverse },
});
