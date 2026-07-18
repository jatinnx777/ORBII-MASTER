import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { appAlert } from '@/components/common';
import { MLMapView, type AvatarMarker } from '@/components/common/MLMapView';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { useReadiness, READINESS_CAP } from '@/services/readiness';
import { subscribePresence, type PresencePeer } from '@/services/community';
import {
  isListening,
  startListening,
  stopListening,
  subscribeStatus,
  type VoiceDetectionStatus,
} from '@/services/voice-detection';
import {
  startBackgroundVoice,
  stopBackgroundVoice,
  saveBgVoiceState,
  requestBatteryExemption,
} from '@/services/background-voice';
import { getFastLocation } from '@/services/location';
import { shareMyLocation } from '@/services/location-share';
import { trackEvent } from '@/services/analytics';
import { comingSoon } from '@/services/coming-soon';
import type { GeoPoint } from '@/types';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const { height: SCREEN_H } = Dimensions.get('window');
const MAP_H = Math.round(SCREEN_H * 0.55);
const SHEET_TOP = Math.round(SCREEN_H * 0.47);

const PLACES = [
  { key: 'police', label: 'Police', icon: 'shield-outline' as const, query: 'police station' },
  { key: 'hospital', label: 'Hospital', icon: 'medkit-outline' as const, query: 'hospital' },
  { key: 'cafe', label: 'Cafe', icon: 'cafe-outline' as const, query: 'cafe' },
  { key: 'metro', label: 'Metro', icon: 'train-outline' as const, query: 'metro station' },
];

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const profile = useAppSelector((s) => s.user.profile);
  const alerts = useAppSelector((s) => s.community.alerts);
  const tier = profile?.premiumTier ?? null;
  const { pct, doneCount, total } = useReadiness();

  const [me, setMe] = useState<GeoPoint | null>(null);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<'people' | 'fake' | 'journey'>('people');
  const [voiceStatus, setVoiceStatus] = useState<VoiceDetectionStatus>(
    isListening() ? 'listening' : 'idle',
  );
  const [voiceBusy, setVoiceBusy] = useState(false);
  const voiceOn = voiceStatus === 'listening' || voiceStatus === 'starting';

  useEffect(() => subscribeStatus(setVoiceStatus), []);
  useEffect(() => subscribePresence(setPeers), []);

  const toggleVoice = async () => {
    if (voiceBusy) return;
    setVoiceBusy(true);
    try {
      if (voiceOn) {
        await stopBackgroundVoice();
        await saveBgVoiceState({ enabled: false, hours: 0 });
        await stopListening();
        return;
      }
      const res = await startListening();
      if (!res.ok) {
        appAlert(
          "Voice SOS couldn't start",
          res.reason === 'permission-denied'
            ? 'ORBII needs microphone access to hear you call for help.'
            : 'Voice SOS runs on the installed Android app.',
        );
        return;
      }
      // Arm background protection too, so she's covered with the app closed.
      await startBackgroundVoice([], 0).catch(() => undefined);
      await saveBgVoiceState({ enabled: true, hours: 0 });
      await requestBatteryExemption().catch(() => undefined);
      trackEvent('voice_sos_enabled', { from: 'home_box' });
    } finally {
      setVoiceBusy(false);
    }
  };
  const loadMe = useCallback(async () => {
    try {
      setMe(await getFastLocation());
    } catch {
      /* location off */
    }
  }, []);
  useFocusEffect(useCallback(() => { void loadMe(); }, [loadMe]));

  const circleUids = useMemo(
    () => new Set((profile?.friends ?? []).map((f) => f.uid).filter((u): u is string => !!u)),
    [profile?.friends],
  );

  const members = useMemo(() => {
    const online = new Map<string, PresencePeer>();
    for (const p of peers) if (circleUids.has(p.userId)) online.set(p.userId, p);
    return (profile?.friends ?? []).map((f) => {
      const live = f.uid ? online.get(f.uid) : undefined;
      return {
        uid: f.uid ?? f.username,
        name: (live?.name || f.name || f.username || 'Member') as string,
        photoUri: live?.photoUri ?? null,
        online: !!live,
      };
    });
  }, [peers, circleUids, profile?.friends]);

  // EVERY nearby person on the map, shown only as an avatar pin — photo or
  // initial, no name and no personal details on the front map. We deliberately
  // do NOT distinguish verified helpers from ordinary users here; on the map
  // they're all just people around you.
  const avatars = useMemo<AvatarMarker[]>(() => {
    const list: AvatarMarker[] = [];
    if (me) list.push({ id: 'me', coordinate: me, photoUri: profile?.photoUri ?? null, name: 'You' });
    for (const p of peers) {
      if (p.userId === profile?.uid || !p.location) continue;
      list.push({ id: p.userId, coordinate: p.location, photoUri: p.photoUri, name: p.name || '' });
    }
    return list;
  }, [me, peers, profile?.uid, profile?.photoUri]);

  const activeAlerts = alerts?.length ?? 0;
  const setupDone = pct >= READINESS_CAP;

  const openPlaces = (query: string) => {
    const near = me ? `${query} near ${me.latitude},${me.longitude}` : query;
    Linking.openURL(`https://www.google.com/maps/search/${encodeURIComponent(near)}`).catch(() => undefined);
  };

  // ── Draggable bottom sheet (built-in PanResponder — no extra libs) ──
  // The sheet is anchored near the top; a translateY moves it DOWN to the
  // collapsed resting position. Dragging the handle slides it, and it snaps to
  // fully-open or collapsed on release.
  const EXPANDED_TOP = insets.top + 54;
  const range = SHEET_TOP - EXPANDED_TOP; // travel from open (0) to collapsed
  const sheetY = useRef(new Animated.Value(range)).current;
  const dragStart = useRef(range);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 5,
      onPanResponderGrant: () => {
        sheetY.stopAnimation((v) => { dragStart.current = v; });
      },
      onPanResponderMove: (_e, g) => {
        const next = Math.max(0, Math.min(range, dragStart.current + g.dy));
        sheetY.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const cur = Math.max(0, Math.min(range, dragStart.current + g.dy));
        const open = g.vy < -0.4 || (g.vy <= 0.4 && cur < range / 2);
        Animated.spring(sheetY, {
          toValue: open ? 0 : range,
          useNativeDriver: true,
          stiffness: 220,
          damping: 26,
          mass: 0.9,
        }).start();
      },
    }),
  ).current;

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await shareMyLocation();
      appAlert(
        res.ok ? 'Location shared' : "Couldn't share your location",
        res.ok
          ? res.contact
            ? `A maps link was sent to ${res.contact}, and your circle was notified.`
            : 'Your circle was notified with your location.'
          : res.error,
      );
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* ── LAYER 1: map ── */}
      <View style={[styles.mapLayer, { height: MAP_H }]}>
        <MLMapView
          style={{ flex: 1 }}
          center={me ?? avatars[0]?.coordinate}
          zoom={14}
          avatarMarkers={avatars}
          fitAll={avatars.length > 1}
          followUser={!!me && avatars.length <= 1}
          interactive
        />
      </View>

      {/* top floating controls */}
      <View style={[styles.topControls, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={() => navigation.navigate('Settings')} style={styles.roundCtl} accessibilityLabel="Settings">
          <Ionicons name="settings-outline" size={20} color={colors.brandDeep} />
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Circles')} style={styles.selector} accessibilityLabel="Choose circle">
          <Text style={styles.selectorText} numberOfLines={1}>My circle</Text>
          <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Notifications')} style={styles.roundCtl} accessibilityLabel="Notifications">
          <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.brandDeep} />
          {activeAlerts > 0 ? <View style={styles.ctlDot} /> : null}
        </Pressable>
      </View>

      {/* bottom-of-map floating buttons */}
      <View style={[styles.mapBottom, { top: SHEET_TOP - 54 }]} pointerEvents="box-none">
        <Pressable onPress={onShare} disabled={sharing} style={styles.checkIn} accessibilityLabel="Share live location">
          <Ionicons name="shield-checkmark" size={17} color={colors.brand} />
          <Text style={styles.checkInText}>{sharing ? 'Sharing…' : 'Share location'}</Text>
        </Pressable>
        <Pressable onPress={loadMe} style={styles.roundCtl} accessibilityLabel="Recenter map">
          <Ionicons name="locate" size={19} color={colors.brandDeep} />
        </Pressable>
      </View>

      {/* ── LAYER 2: draggable bottom sheet ── */}
      <Animated.View
        style={[
          styles.sheet,
          { top: EXPANDED_TOP, bottom: -range, transform: [{ translateY: sheetY }] },
        ]}
      >
        {/* Only the handle zone drives the drag, so the list still scrolls. */}
        <View {...pan.panHandlers} style={styles.handleZone}>
          <View style={styles.handle} />
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.sheetScroll, { paddingBottom: insets.bottom + range + 96 }]}
        >
          {/* Voice SOS activation box — also starts background protection. */}
          <Pressable
            onPress={toggleVoice}
            disabled={voiceBusy}
            style={({ pressed }) => [styles.voiceBox, voiceOn && styles.voiceBoxOn, pressed && styles.pressed]}
            accessibilityRole="switch"
            accessibilityState={{ checked: voiceOn }}
            accessibilityLabel="Voice SOS"
          >
            <View style={[styles.voiceIcon, voiceOn && styles.voiceIconOn]}>
              <Ionicons name={voiceOn ? 'mic' : 'mic-outline'} size={22} color={voiceOn ? colors.textInverse : colors.brandDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.voiceTitle}>{voiceOn ? 'Voice SOS is on' : 'Activate Voice SOS'}</Text>
              <Text style={styles.voiceSub}>
                {voiceOn ? 'Listening for "help, help", even in the background.' : 'Hands-free. Also runs while the app is closed.'}
              </Text>
            </View>
            <View style={[styles.voicePill, voiceOn && styles.voicePillOn]}>
              <Text style={[styles.voicePillText, voiceOn && styles.voicePillTextOn]}>{voiceOn ? 'ON' : 'OFF'}</Text>
            </View>
          </Pressable>

          {/* A. Safety status */}
          <Pressable
            onPress={() => navigation.navigate('SafetyReadiness')}
            style={({ pressed }) => [styles.statusCard, pressed && styles.pressed]}
          >
            <View style={styles.statusTop}>
              <Text style={styles.statusTitle}>Your safety status</Text>
              <Text style={styles.statusPct}>{pct}% safe</Text>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.max(pct, 4)}%` }]} />
            </View>
            <Text style={styles.statusHint}>
              {setupDone ? "You're fully set up and protected." : `${doneCount} of ${total} steps done. Tap to finish.`}
            </Text>
          </Pressable>

          {/* B. Circle */}
          <Text style={styles.sectionH}>Your circle</Text>
          {members.length === 0 ? (
            <Pressable onPress={() => navigation.navigate('Circles')} style={({ pressed }) => [styles.emptyCircle, pressed && styles.pressed]}>
              <Ionicons name="person-add" size={20} color={colors.brandDeep} />
              <Text style={styles.emptyCircleText}>Add family to protect them</Text>
            </Pressable>
          ) : (
            <View style={styles.card}>
              {members.map((m, i) => (
                <View key={m.uid} style={[styles.memberRow, i > 0 && styles.rowDivider]}>
                  <View style={[styles.mAvatarRing, { borderColor: m.online ? colors.sage : colors.creamDeep }]}>
                    {m.photoUri ? (
                      <Image source={{ uri: m.photoUri }} style={styles.mAvatar} />
                    ) : (
                      <View style={styles.mAvatarFb}>
                        <Text style={styles.mInitial}>{m.name.charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mName}>{m.name}</Text>
                    <Text style={[styles.mStatus, { color: m.online ? colors.sageDeep : colors.textMuted }]}>
                      {m.online ? 'Online now' : 'Offline'}
                    </Text>
                  </View>
                  {m.online ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.sage} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={18} color={colors.textMuted} />
                  )}
                </View>
              ))}
            </View>
          )}

          {/* C. Three quick tabs */}
          <View style={styles.tabs}>
            <Pressable onPress={() => setTab('people')} style={[styles.tab, tab === 'people' && styles.tabOn]}>
              <Ionicons name="people" size={19} color={tab === 'people' ? colors.textInverse : colors.brandDeep} />
              {tab === 'people' ? <Text style={styles.tabOnText}>Circle</Text> : null}
            </Pressable>
            <Pressable onPress={() => { setTab('fake'); comingSoon('Fake call'); }} style={[styles.tab, tab === 'fake' && styles.tabOn]}>
              <Ionicons name="call" size={19} color={tab === 'fake' ? colors.textInverse : colors.brandDeep} />
              {tab === 'fake' ? <Text style={styles.tabOnText}>Fake call</Text> : null}
            </Pressable>
            <Pressable onPress={() => { setTab('journey'); navigation.navigate('SafeJourneyStart'); }} style={[styles.tab, tab === 'journey' && styles.tabOn]}>
              <Ionicons name="navigate" size={19} color={tab === 'journey' ? colors.textInverse : colors.brandDeep} />
              {tab === 'journey' ? <Text style={styles.tabOnText}>Journey</Text> : null}
            </Pressable>
          </View>

          {/* D. Nearby places */}
          <Text style={styles.miniLabel}>NEARBY SAFE PLACES</Text>
          <View style={styles.placesRow}>
            {PLACES.map((p) => (
              <Pressable key={p.key} onPress={() => openPlaces(p.query)} style={({ pressed }) => [styles.placeTile, pressed && styles.pressed]}>
                <Ionicons name={p.icon} size={19} color={colors.brandDeep} />
                <Text style={styles.placeLabel}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Alerts */}
          <Pressable onPress={() => navigation.navigate('CommunityAlerts')} style={({ pressed }) => [styles.alertCard, pressed && styles.pressed]}>
            <View style={[styles.alertIcon, activeAlerts > 0 && { backgroundColor: colors.coralSoft }]}>
              <Ionicons name={activeAlerts > 0 ? 'alert-circle' : 'shield-checkmark-outline'} size={20} color={activeAlerts > 0 ? colors.coralDeep : colors.sageDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>
                {activeAlerts > 0 ? `${activeAlerts} active alert${activeAlerts > 1 ? 's' : ''} nearby` : 'No active alerts'}
              </Text>
              <Text style={styles.alertSub}>View all alerts</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          {/* Go Pro */}
          {tier !== 'family' ? (
            <Pressable onPress={() => navigation.navigate('PremiumUpgrade')} style={({ pressed }) => [styles.proCard, pressed && styles.pressed]}>
              <View style={styles.proIcon}>
                <Ionicons name="sparkles" size={17} color={colors.goldDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.proTitle}>{tier === 'plus' ? 'Upgrade to ORBII Family' : 'Go Pro with ORBII Plus'}</Text>
                <Text style={styles.proSub}>{tier === 'plus' ? 'Protect up to 4 people you love.' : 'Verified helpers reach you, not just your circle.'}</Text>
              </View>
              <View style={styles.proBtn}>
                <Text style={styles.proBtnText}>Upgrade</Text>
              </View>
            </Pressable>
          ) : null}

          {/* 2x2 grid */}
          <View style={styles.grid}>
            <GridTile icon="call-outline" title="Fake call" sub="Escape a moment" onPress={() => comingSoon('Fake call')} />
            <GridTile icon="chatbubbles-outline" title="Community" sub="Share & support" onPress={() => navigation.navigate('CommunityFeed')} />
            <GridTile icon="navigate-outline" title="Location sharing" sub="Send your spot" onPress={onShare} />
            <GridTile icon="recording-outline" title="Record evidence" sub="Your recordings" onPress={() => navigation.navigate('Recordings')} />
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function GridTile({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.gTile, pressed && styles.pressed]} accessibilityLabel={title}>
      <View style={styles.gIcon}>
        <Ionicons name={icon} size={19} color={colors.brandDeep} />
      </View>
      <Text style={styles.gTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.gSub} numberOfLines={1}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  pressed: { opacity: 0.92 },

  mapLayer: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: colors.creamDeep },
  topControls: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    zIndex: 5,
  },
  roundCtl: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  ctlDot: { position: 'absolute', top: 10, right: 11, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral, borderWidth: 1.5, borderColor: colors.surface },
  selector: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 22,
    ...shadows.icon,
  },
  selectorText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },

  mapBottom: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 5,
  },
  checkIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderRadius: radius.pill,
    ...shadows.icon,
  },
  checkInText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.brand },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: spacing.sm,
    shadowColor: '#2D2D3D',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 16,
  },
  handleZone: { alignItems: 'center', paddingTop: 4, paddingBottom: spacing.sm },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.creamDeep },
  sheetScroll: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },

  voiceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.brandSoft,
    ...shadows.card,
  },
  voiceBoxOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  voiceIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  voiceIconOn: { backgroundColor: colors.brand },
  voiceTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  voiceSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  voicePill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.creamDeep },
  voicePillOn: { backgroundColor: colors.brand },
  voicePillText: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, color: colors.textMuted, letterSpacing: 0.5 },
  voicePillTextOn: { color: colors.textInverse },

  statusCard: { backgroundColor: colors.brandSoft, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm },
  statusTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  statusPct: { fontFamily: fontFamilies.poppinsBold, fontSize: 14.5, color: colors.brandDeep },
  bar: { height: 9, borderRadius: 5, backgroundColor: colors.surface, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5, backgroundColor: colors.brand },
  statusHint: { ...typography.caption, fontSize: 12, color: colors.textSecondary },

  sectionH: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.textPrimary, letterSpacing: -0.3 },
  emptyCircle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
  },
  emptyCircleText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textSecondary },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, ...shadows.card, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  mAvatarRing: { width: 56, height: 56, borderRadius: 28, borderWidth: 2.5, padding: 2, alignItems: 'center', justifyContent: 'center' },
  mAvatar: { width: '100%', height: '100%', borderRadius: 25 },
  mAvatarFb: { width: '100%', height: '100%', borderRadius: 25, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  mInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.brandDeep },
  mName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  mStatus: { ...typography.caption, fontSize: 12, marginTop: 1 },

  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingVertical: 13,
  },
  tabOn: { backgroundColor: colors.brand },
  tabOnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textInverse },

  miniLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, letterSpacing: 1, marginBottom: -spacing.xs },
  placesRow: { flexDirection: 'row', gap: spacing.sm },
  placeTile: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.md,
    alignItems: 'center', gap: 7, ...shadows.card,
  },
  placeLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.textPrimary },

  alertCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, ...shadows.card },
  alertIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.sageSoft, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  alertSub: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },

  proCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.goldSoft, borderRadius: radius.xl, padding: spacing.md },
  proIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  proTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.textPrimary },
  proSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  proBtn: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  proBtnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textInverse },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  gTile: { flexGrow: 1, flexBasis: '46%', backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, gap: 6, ...shadows.card },
  gIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  gTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  gSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary },
});
