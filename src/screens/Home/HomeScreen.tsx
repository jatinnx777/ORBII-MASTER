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
import { listCircles, listCircleMembers, type Circle } from '@/services/circles';
import { loadZoneEvents, type ZoneEvent } from '@/services/geofence';
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
// So the map always draws immediately (it needs a camera target). It recenters
// on the user the moment a real fix arrives. Roughly central India.
const DEFAULT_CENTER = { latitude: 22.9734, longitude: 78.6569 };

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
  const [circles, setCircles] = useState<Circle[]>([]);
  const [selectedCircle, setSelectedCircle] = useState<string | null>(null);
  const [circleMemberUids, setCircleMemberUids] = useState<Set<string>>(new Set());
  const [zoneEvents, setZoneEvents] = useState<ZoneEvent[]>([]);
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
  // Load location + the user's circles once on mount, so the map draws right
  // away and the selector is populated.
  useEffect(() => {
    void loadMe();
    listCircles()
      .then((cs) => {
        setCircles(cs);
        setSelectedCircle((cur) => cur ?? cs.find((c) => c.isDefault)?.id ?? cs[0]?.id ?? null);
      })
      .catch(() => undefined);
    if (profile?.uid) {
      loadZoneEvents(profile.uid).then(setZoneEvents).catch(() => undefined);
    }
  }, [loadMe, profile?.uid]);
  useFocusEffect(useCallback(() => { void loadMe(); }, [loadMe]));

  // Members of the SELECTED circle only — so a user with several circles sees
  // one clean group on the map, not everyone at once.
  useEffect(() => {
    if (!selectedCircle) {
      setCircleMemberUids(new Set());
      return;
    }
    let alive = true;
    listCircleMembers(selectedCircle)
      .then((ms) => {
        if (alive) setCircleMemberUids(new Set(ms.map((m) => m.userId)));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [selectedCircle]);

  const selectedCircleName = circles.find((c) => c.id === selectedCircle)?.name ?? 'My circle';

  const members = useMemo(() => {
    const online = new Map<string, PresencePeer>();
    for (const p of peers) if (circleMemberUids.has(p.userId)) online.set(p.userId, p);
    // Members list in the sheet: everyone in the selected circle, tagged online
    // if we can see them in presence.
    const out: { uid: string; name: string; photoUri: string | null; online: boolean }[] = [];
    for (const uid of circleMemberUids) {
      if (uid === profile?.uid) continue;
      const live = online.get(uid);
      out.push({
        uid,
        name: live?.name || 'Member',
        photoUri: live?.photoUri ?? null,
        online: !!live,
      });
    }
    return out;
  }, [peers, circleMemberUids, profile?.uid]);

  // Map pins: you + the online members of the SELECTED circle. Avatar only, no
  // names or personal details on the front map.
  const avatars = useMemo<AvatarMarker[]>(() => {
    const list: AvatarMarker[] = [];
    if (me) list.push({ id: 'me', coordinate: me, photoUri: profile?.photoUri ?? null, name: 'You' });
    for (const p of peers) {
      if (p.userId === profile?.uid || !p.location) continue;
      if (!circleMemberUids.has(p.userId)) continue;
      list.push({ id: p.userId, coordinate: p.location, photoUri: p.photoUri, name: p.name || '' });
    }
    return list;
  }, [me, peers, circleMemberUids, profile?.uid, profile?.photoUri]);

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
          center={me ?? avatars[0]?.coordinate ?? DEFAULT_CENTER}
          zoom={me ? 14 : 5}
          avatarMarkers={avatars}
          fitAll={avatars.length > 1}
          followUser={!!me && avatars.length <= 1}
          interactive
        />
      </View>

      {/* top floating controls */}
      <View style={[styles.topControls, { top: Math.max(insets.top, 12) + 10 }]} pointerEvents="box-none">
        <Pressable onPress={() => navigation.navigate('Settings')} style={styles.topBtn} accessibilityLabel="Settings">
          <Ionicons name="settings-outline" size={20} color={colors.brandDeep} />
        </Pressable>

        {/* Circle selector — side-scroll to pick which circle to view. The
            map + members below reflect the chosen circle. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.selectorScroll}
          contentContainerStyle={styles.selectorRow}
        >
          {circles.length === 0 ? (
            <Pressable onPress={() => navigation.navigate('Circles')} style={styles.chip}>
              <Ionicons name="add" size={15} color={colors.brandDeep} />
              <Text style={styles.chipText}>New circle</Text>
            </Pressable>
          ) : (
            circles.map((c) => {
              const on = c.id === selectedCircle;
              return (
                <Pressable key={c.id} onPress={() => setSelectedCircle(c.id)} style={[styles.chip, on && styles.chipOn]}>
                  <Ionicons name="people" size={14} color={on ? colors.textInverse : colors.brandDeep} />
                  <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{c.name}</Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <Pressable onPress={() => navigation.navigate('Notifications')} style={styles.topBtn} accessibilityLabel="Notifications">
          <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.brandDeep} />
          {activeAlerts > 0 ? <View style={styles.ctlDot} /> : null}
        </Pressable>
      </View>

      {/* bottom-of-map floating buttons. They ride WITH the sheet (translateY:
          sheetY) so dragging the sheet up never leaves them overlapping the
          content, and they fade out as the sheet covers the map. */}
      <Animated.View
        style={[
          styles.mapBottom,
          {
            top: EXPANDED_TOP - 54,
            transform: [{ translateY: sheetY }],
            opacity: sheetY.interpolate({ inputRange: [0, range * 0.6, range], outputRange: [0, 0.6, 1] }),
          },
        ]}
        pointerEvents="box-none"
      >
        <Pressable onPress={onShare} disabled={sharing} style={styles.checkIn} accessibilityLabel="Share live location">
          <Ionicons name="shield-checkmark" size={17} color={colors.brand} />
          <Text style={styles.checkInText}>{sharing ? 'Sharing…' : 'Share location'}</Text>
        </Pressable>
        <Pressable onPress={loadMe} style={styles.roundCtl} accessibilityLabel="Recenter map">
          <Ionicons name="locate" size={19} color={colors.brandDeep} />
        </Pressable>
      </Animated.View>

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
          contentContainerStyle={[styles.sheetScroll, { paddingBottom: insets.bottom + range + 150 }]}
        >
          {/* Consent-first sharing state — who can see you, right now. The
              opposite of silent tracking: always visible, always yours to
              change, and we say plainly that we never sell it. */}
          <Pressable
            onPress={() => {
              if (selectedCircle) navigation.navigate('CircleDetail', { circleId: selectedCircle });
              else navigation.navigate('Circles');
            }}
            style={({ pressed }) => [styles.shareState, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Who can see your location"
          >
            <View style={styles.shareEye}>
              <Ionicons name={members.length ? 'eye' : 'eye-off'} size={18} color={colors.brandDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.shareTitle}>
                {members.length
                  ? `${members.length} ${members.length === 1 ? 'person can' : 'people can'} see your location`
                  : 'No one can see your location'}
              </Text>
              <Text style={styles.shareSub}>
                {members.length
                  ? `In ${selectedCircleName}. Tap to change who. ORBII never sells your location.`
                  : 'Add trusted people. Only those you choose can ever see you.'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

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
          <Text style={styles.sectionH}>{selectedCircleName}</Text>
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

          {/* B2. Recent activity — real safe-zone crossings, the calm ambient
              feed. Only shows when there's something to show. */}
          {zoneEvents.length > 0 ? (
            <>
              <Text style={styles.sectionH}>Recent activity</Text>
              <View style={styles.card}>
                {zoneEvents.slice(0, 4).map((e, i) => (
                  <View key={e.id} style={[styles.activityRow, i > 0 && styles.rowDivider]}>
                    <View style={[styles.activityIcon, { backgroundColor: e.kind === 'enter' ? colors.sageSoft : colors.creamDeep }]}>
                      <Ionicons
                        name={e.kind === 'enter' ? 'enter-outline' : 'exit-outline'}
                        size={17}
                        color={e.kind === 'enter' ? colors.sageDeep : colors.brandDeep}
                      />
                    </View>
                    <Text style={styles.activityText}>
                      {e.kind === 'enter' ? 'Arrived at ' : 'Left '}
                      <Text style={styles.activityPlace}>{e.label}</Text>
                    </Text>
                    <Text style={styles.activityTime}>{timeAgo(e.createdAt)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placesRow}>
            {PLACES.map((p) => (
              <Pressable key={p.key} onPress={() => openPlaces(p.query)} style={({ pressed }) => [styles.placeTile, pressed && styles.pressed]}>
                <Ionicons name={p.icon} size={20} color={colors.brandDeep} />
                <Text style={styles.placeLabel}>{p.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

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

          {/* quick grid */}
          <View style={styles.grid}>
            <GridTile icon="locate-outline" title="Geofencing" sub="Alert if they leave an area" onPress={() => navigation.navigate('ZoneEditor')} />
            <GridTile icon="warning-outline" title="Disaster mode" sub="Reach people offline" onPress={() => navigation.navigate('DisasterMode')} />
            <GridTile icon="chatbubbles-outline" title="Community" sub="Share & support" onPress={() => navigation.navigate('CommunityFeed')} />
            <GridTile icon="navigate-outline" title="Location sharing" sub="Send your spot" onPress={onShare} />
            <GridTile icon="recording-outline" title="Record evidence" sub="Your recordings" onPress={() => navigation.navigate('Recordings')} />
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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
    gap: 4,
    zIndex: 5,
    // One unified translucent bar holding the gear, circle tabs and alerts,
    // so they anchor cleanly over the map instead of floating separately.
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 26,
    paddingHorizontal: 6,
    paddingVertical: 6,
    ...shadows.icon,
  },
  topBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
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
  selectorScroll: { flex: 1, marginHorizontal: 2 },
  // Extra right padding + a small left pad so the first/last circle chips never
  // sit flush against the gear/chat icons or get clipped at the scroll edge.
  selectorRow: { gap: spacing.sm, alignItems: 'center', paddingLeft: 2, paddingRight: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 20,
    maxWidth: 150,
    ...shadows.icon,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textPrimary },
  chipTextOn: { color: colors.textInverse },

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

  shareState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  shareEye: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  shareSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 2, lineHeight: 15 },

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
  statusTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textSecondary },
  statusPct: { fontFamily: fontFamilies.poppinsBold, fontSize: 23, color: colors.brandDeep, letterSpacing: -0.5 },
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

  activityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 12 },
  activityIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  activityText: { flex: 1, fontFamily: fontFamilies.poppinsRegular, fontSize: 13.5, color: colors.textSecondary },
  activityPlace: { fontFamily: fontFamilies.poppinsSemiBold, color: colors.textPrimary },
  activityTime: { ...typography.caption, fontSize: 11.5, color: colors.textMuted },

  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingVertical: 13,
  },
  tabOn: { backgroundColor: colors.brand },
  tabOnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textInverse },

  miniLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, letterSpacing: 1, marginBottom: -spacing.xs },
  placesRow: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.lg, paddingVertical: 2 },
  placeTile: {
    width: 84, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.md,
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
