import React, { useEffect, useRef } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Card,
  ScreenContainer,
  StarRating,
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  helperModeSet,
  incomingJobReceived,
} from '@/redux/slices/helperSlice';
import { trackEvent } from '@/services/analytics';
import { fireLocalNotification } from '@/services/notifications';
import { supabase } from '@/services/supabase';
import { haversineMeters, etaSeconds } from '@/utils/geo';
import type { HelperJob } from '@/types';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'HelperDashboard'>;

const HELPER_RADIUS_M = 2000;

export function HelperDashboardScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const helper = useAppSelector((s) => s.helper);
  const profile = useAppSelector((s) => s.user.profile);
  const currentLocation = useAppSelector((s) => s.sos.currentLocation);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!helper.mode || !profile || !currentLocation) return;

    const upsert = () =>
      supabase
        .from('helpers_live')
        .upsert({
          user_id: profile.uid,
          lat: currentLocation.latitude,
          lng: currentLocation.longitude,
          is_online: true,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) console.warn('[helper] upsert failed', error);
        });

    upsert();
    heartbeatRef.current = setInterval(upsert, 30_000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      supabase
        .from('helpers_live')
        .update({ is_online: false })
        .eq('user_id', profile.uid)
        .then(({ error }) => {
          if (error) console.warn('[helper] offline update failed', error);
        });
    };
  }, [helper.mode, profile, currentLocation]);

  useEffect(() => {
    if (!helper.mode || helper.currentJob) return;

    const channel = supabase
      .channel('sos_incoming')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sos_events' },
        (payload) => {
          const row = payload.new as {
            id: string;
            user_id: string;
            lat: number;
            lng: number;
            address: string | null;
            status: string;
          };
          if (row.status !== 'active') return;
          const base = currentLocation;
          if (!base) return;
          const distance = haversineMeters(base, {
            latitude: row.lat,
            longitude: row.lng,
          });
          if (distance > HELPER_RADIUS_M) return;

          supabase
            .from('profiles')
            .select('name, photo_url, phone')
            .eq('id', row.user_id)
            .single()
            .then(({ data }) => {
              const job: HelperJob = {
                id: row.id,
                user: {
                  id: row.user_id,
                  name: data?.name ?? 'A nearby user',
                  photoUri: data?.photo_url ?? null,
                  phone: data?.phone ?? '',
                },
                location: {
                  latitude: row.lat,
                  longitude: row.lng,
                  address: row.address ?? null,
                },
                distanceMeters: Math.round(distance),
                etaSeconds: etaSeconds(distance),
                reward: 100,
                createdAt: Date.now(),
              };
              dispatch(incomingJobReceived(job));
              fireLocalNotification(
                'SOS nearby!',
                `${job.user.name} needs help ${Math.round(distance)}m away`,
              );
              navigation.navigate('AcceptSOS');
            });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [helper.mode, helper.currentJob, currentLocation, dispatch, navigation]);

  const handleToggle = (next: boolean) => {
    if (next && helper.verification !== 'verified') {
      Alert.alert(
        'Verification needed',
        'Complete KYC verification before going online.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Verify',
            onPress: () => navigation.navigate('HelperVerification'),
          },
        ],
      );
      return;
    }
    dispatch(helperModeSet(next));
    if (next) trackEvent('helper_mode_enabled');
  };

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={[styles.statusCard, helper.mode && styles.statusOn]}>
          <View style={styles.statusRow}>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.statusTitle,
                  { color: helper.mode ? colors.textInverse : colors.textPrimary },
                ]}
              >
                {helper.mode ? 'You are online' : 'You are offline'}
              </Text>
              <Text
                style={[
                  styles.statusBody,
                  { color: helper.mode ? colors.textInverse : colors.textSecondary },
                ]}
              >
                {helper.mode
                  ? 'You can receive SOS alerts within 2 km.'
                  : 'Go online to start receiving SOS alerts.'}
              </Text>
            </View>
            <Switch
              value={helper.mode}
              onValueChange={handleToggle}
              trackColor={{ true: colors.textInverse, false: colors.border }}
              thumbColor={helper.mode ? colors.success : colors.textMuted}
            />
          </View>
        </Card>

        <View style={styles.statsGrid}>
          <Stat label="Lives saved" value={String(helper.livesSaved)} />
          <Stat label="Total jobs" value={String(helper.totalJobs)} />
          <Stat
            label="Rating"
            value={helper.rating.toFixed(1)}
            right={<StarRating value={helper.rating} size={12} />}
          />
        </View>

        <Card style={styles.earningsCard}>
          <View style={styles.earningsHeader}>
            <View>
              <Text style={styles.earningsLabel}>Pending earnings</Text>
              <Text style={styles.earningsValue}>₹{helper.pendingBalance}</Text>
            </View>
            <Pressable
              style={styles.viewBtn}
              onPress={() => navigation.navigate('Withdraw')}
            >
              <Text style={styles.viewText}>Withdraw</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </Pressable>
          </View>
          <View style={styles.earningsRow}>
            <Text style={styles.earningsMeta}>Withdrawn: ₹{helper.balance}</Text>
            <Text style={styles.earningsMeta}>₹100 per SOS resolved</Text>
          </View>
        </Card>

        <Card style={{ gap: spacing.md }}>
          <Text style={styles.sectionTitle}>How helper mode works</Text>
          <Tip
            icon="location"
            text="We ping you when an SOS drops within 2 km."
          />
          <Tip icon="call" text="Tap accept within 30s to lock the job." />
          <Tip icon="navigate" text="Navigate in-app and tap 'Arrived' when there." />
          <Tip
            icon="cash"
            text="₹100 is credited automatically on resolution."
          />
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

function Stat({
  label,
  value,
  right,
}: {
  label: string;
  value: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={statStyles.cell}>
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
      {right ? <View style={{ marginTop: 2 }}>{right}</View> : null}
    </View>
  );
}

const statStyles = StyleSheet.create({
  cell: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 2,
  },
  value: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});

function Tip({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={tipStyles.row}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={tipStyles.text}>{text}</Text>
    </View>
  );
}

const tipStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  text: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
});

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  statusCard: {
    padding: spacing.md,
  },
  statusOn: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
  },
  statusBody: {
    ...typography.caption,
    marginTop: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  earningsCard: {
    gap: spacing.sm,
  },
  earningsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  earningsLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  earningsValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
    marginTop: 2,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewText: {
    ...typography.bodyMedium,
    color: colors.primary,
  },
  earningsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  earningsMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  sectionTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
});
