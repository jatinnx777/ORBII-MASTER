import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { jobCompleted, jobStatusChanged } from '@/redux/slices/helperSlice';
import { trackEvent } from '@/services/analytics';
import { formatDistance, formatEta, haversineMeters, interpolate } from '@/utils/geo';
import type { GeoPoint } from '@/types';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'HelperNavigation'>;

export function HelperNavigationScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const job = useAppSelector((s) => s.helper.currentJob);
  const status = useAppSelector((s) => s.helper.jobStatus);
  const currentLocation = useAppSelector((s) => s.sos.currentLocation);

  const [progress, setProgress] = useState(0);
  const startPoint = useRef<GeoPoint | null>(
    currentLocation ?? (job ? { latitude: job.location.latitude - 0.005, longitude: job.location.longitude - 0.005 } : null),
  );

  useEffect(() => {
    if (!job || status === 'arrived') return;
    const id = setInterval(() => {
      setProgress((p) => Math.min(1, p + 0.02));
    }, 500);
    return () => clearInterval(id);
  }, [job, status]);

  useEffect(() => {
    if (progress >= 1 && status === 'accepted') {
      dispatch(jobStatusChanged('arrived'));
      trackEvent('helper_arrived', { jobId: job?.id });
    }
  }, [progress, status, dispatch, job?.id]);

  if (!job || !startPoint.current) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No active job.</Text>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.emptyLink}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const currentPoint = interpolate(startPoint.current, job.location, progress);
  const remaining = haversineMeters(currentPoint, job.location);

  const handleResolved = () => {
    dispatch(jobCompleted({ reward: job.reward, lifeSaved: true }));
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  const handleCall = () => {
    Linking.openURL(`tel:${job.user.phone}`).catch(() => undefined);
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel this job?',
      'Your rating may drop if you cancel after accepting.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: () => {
            dispatch(jobStatusChanged('declined'));
            navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <View>
          <Text style={styles.userName}>{job.user.name}</Text>
          <Text style={styles.userMeta}>{job.location.address ?? 'Nearby'}</Text>
        </View>
        <Pressable
          style={styles.callBtn}
          onPress={handleCall}
          accessibilityRole="button"
          accessibilityLabel="Call user"
        >
          <Ionicons name="call" size={20} color={colors.textInverse} />
        </Pressable>
      </View>

      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: job.location.latitude,
          longitude: job.location.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        showsUserLocation={false}
      >
        <Marker coordinate={currentPoint} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.youPin}>
            <Ionicons name="navigate" size={18} color={colors.textInverse} />
          </View>
        </Marker>
        <Marker coordinate={job.location} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.userPin} />
        </Marker>
        <Polyline
          coordinates={[currentPoint, job.location]}
          strokeColor={colors.primary}
          strokeWidth={3}
          lineDashPattern={[6, 6]}
        />
      </MapView>

      <View style={styles.sheet}>
        <Text style={styles.sheetDistance}>
          {status === 'arrived' ? 'You have arrived' : formatDistance(remaining)}
        </Text>
        <Text style={styles.sheetEta}>
          {status === 'arrived'
            ? 'Confirm when you are with the user.'
            : `ETA ${formatEta(Math.round(remaining / 5))}`}
        </Text>

        {status === 'arrived' ? (
          <Button label="I'm with the user" onPress={handleResolved} />
        ) : (
          <Button label="Cancel job" variant="outline" onPress={handleCancel} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    position: 'absolute',
    top: 44,
    left: spacing.md,
    right: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.textPrimary,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    zIndex: 2,
  },
  userName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textInverse,
  },
  userMeta: {
    ...typography.caption,
    color: colors.textInverse,
    opacity: 0.8,
  },
  callBtn: {
    marginLeft: 'auto',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  youPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1976D2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.textInverse,
  },
  userPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.textInverse,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: spacing.sm,
  },
  sheetDistance: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    color: colors.textPrimary,
  },
  sheetEta: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  emptyText: { ...typography.h3, color: colors.textPrimary },
  emptyLink: { ...typography.bodyMedium, color: colors.primary },
});
