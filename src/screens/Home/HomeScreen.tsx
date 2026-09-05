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
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { appAlert, CircleSwitcher, CircleSwitcherTrigger, GlassButton, CoverageHeader } from '@/components/common';
import { MLMapView, type AvatarMarker } from '@/components/common/MLMapView';
import { loadCircleMembersLocations, sameMemberLocations, type MemberLocation } from '@/services/circle-location';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { useReadiness, READINESS_CAP } from '@/services/readiness';
import { subscribePresence, type PresencePeer } from '@/services/community';
import { listCircles, listCircleMembers, type Circle } from '@/services/circles';
import { formatDuration, loadVisits, type Visit } from '@/services/geofence';
import {
  isListening,
  armVoiceSos,
  disarmVoiceSos,
  subscribeStatus,
  type VoiceDetectionStatus,
} from '@/services/voice-detection';
import { VoiceDurationSheet } from '@/components/common';
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
  // Smoothly grow the safety-status bar toward the current % (endowed progress:
  // a bar that visibly fills pulls people to finish setup).
  const barAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(barAnim, { toValue: pct, duration: 650, useNativeDriver: false }).start();
  }, [pct, barAnim]);

  const [me, setMe] = useState<GeoPoint | null>(null);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [selectedCircle, setSelectedCircle] = useState<string | null>(null);
  const [circleMemberUids, setCircleMemberUids] = useState<Set<string>>(new Set());
  const [visits, setVisits] = useState<Visit[]>([]);
  const [sharing, setSharing] = useState(false);
  // Last-known location of circle members who share it, survives them going
  // offline (from circle_locations), so the map isn't empty when nobody's live.
  const [memberLocs, setMemberLocs] = useState<MemberLocation[]>([]);
  const [tab, setTab] = useState<'people' | 'fake' | 'journey'>('people');
  const [voiceStatus, setVoiceStatus] = useState<VoiceDetectionStatus>(
    isListening() ? 'listening' : 'idle',
  );
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const voiceOn = voiceStatus === 'listening' || voiceStatus === 'starting';

  useEffect(() => subscribeStatus(setVoiceStatus), []);
  useEffect(() => subscribePresence(setPeers), []);

  const toggleVoice = async () => {
    if (voiceBusy) return;
    if (voiceOn) {
      setVoiceBusy(true);
      try {
        await disarmVoiceSos();
      } finally {
        setVoiceBusy(false);
      }
      return;
    }
    // Turning ON always goes through the duration picker first.
    setDurationOpen(true);
  };

  const onPickDuration = async (hours: number) => {
    setDurationOpen(false);
    setVoiceBusy(true);
    try {
      const res = await armVoiceSos(hours);
      if (!res.ok) {
        appAlert(
          "Voice SOS couldn't start",
          res.reason === 'permission-denied'
            ? 'ORBII needs microphone access to hear you call for help.'
            : 'Voice SOS runs on the installed Android app.',
        );
        return;
      }
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
      loadVisits(50).then(setVisits).catch(() => undefined);
    }
  }, [loadMe, profile?.uid]);
  useFocusEffect(useCallback(() => { void loadMe(); }, [loadMe]));

  // Pull circle members' last-known locations (opt-in sharers) on focus + a slow
  // poll, so offline members still appear on the map at their last position.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      // Keep the previous array when nothing moved, so the map markers are not
      // rebuilt and re-serialised every 30 seconds for no reason.
      const run = () =>
        loadCircleMembersLocations()
          .then((l) => alive && setMemberLocs((prev) => (sameMemberLocations(prev, l) ? prev : l)))
          .catch(() => undefined);
      run();
      const id = setInterval(run, 30_000);
      return () => {
        alive = false;
        clearInterval(id);
      };
    }, []),
  );

  // Members of the SELECTED circle only, so a user with several circles sees
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
    const shown = new Set<string>();
    if (me) list.push({ id: 'me', coordinate: me, photoUri: profile?.photoUri ?? null, name: 'You' });
    // Live (online) members first, freshest position wins.
    for (const p of peers) {
      if (p.userId === profile?.uid || !p.location) continue;
      if (!circleMemberUids.has(p.userId)) continue;
      list.push({ id: p.userId, coordinate: p.location, photoUri: p.photoUri, name: p.name || '' });
      shown.add(p.userId);
    }
    // Then last-known positions for members who are offline but share location.
    for (const m of memberLocs) {
      if (m.userId === profile?.uid || shown.has(m.userId)) continue;
      if (!circleMemberUids.has(m.userId)) continue;
      list.push({
        id: m.userId,
        coordinate: { latitude: m.lat, longitude: m.lng },
        photoUri: m.photoUri,
        name: m.name || '',
      });
      shown.add(m.userId);
    }
    return list;
  }, [me, peers, memberLocs, circleMemberUids, profile?.uid, profile?.photoUri]);

  const activeAlerts = alerts?.length ?? 0;
  const setupDone = pct >= READINESS_CAP;

  // ── Draggable bottom sheet (built-in PanResponder, no extra libs) ──
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
        <GlassButton
          icon="settings-outline"
          size={42}
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Settings"
        />

        {/* The circle name is the control. Tapping it blurs the map out so the
            only decision on screen is which group you are looking at. */}
        <View style={styles.switcherSlot}>
          <CircleSwitcherTrigger
            name={circles.length === 0 ? 'New circle' : selectedCircleName}
            count={members.length}
            onPress={() => (circles.length === 0 ? navigation.navigate('CircleCreate') : setSwitcherOpen(true))}
          />
        </View>

        {/* Circles was reachable only by tapping a status row halfway down the
            sheet, which is to say it was not reachable. It is not a tab either,
            because the bar is four icons split around the centre SOS and a
            fifth breaks that. So it lives here, next to notifications, always
            on screen whatever the sheet is doing. */}
        <View style={styles.topBtns}>
          <GlassButton
            icon="people-outline"
            size={42}
            onPress={() => navigation.navigate('Circles')}
            accessibilityLabel="Your circles"
          />
          <View>
            <GlassButton
              icon="chatbubble-ellipses-outline"
              size={42}
              onPress={() => navigation.navigate('Notifications')}
              accessibilityLabel="Notifications"
            />
            {activeAlerts > 0 ? <View style={styles.ctlDot} pointerEvents="none" /> : null}
          </View>
        </View>
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
        <View style={styles.ctlStack}>
          <GlassButton
            icon="expand"
            onPress={() => navigation.navigate('CircleMap')}
            accessibilityLabel="Open the full live map"
          />
          <GlassButton icon="locate" onPress={loadMe} accessibilityLabel="Recenter map" />
        </View>
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
          {/* Which shield is live here, stated before it matters rather than
              discovered during an emergency. Tapping explains the difference. */}
          <View style={styles.coverageRow}>
            <CoverageHeader />
          </View>

          {/* Consent-first sharing state, who can see you, right now. The
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

          {/* Voice SOS activation box, also starts background protection. */}
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
              <Animated.View
                style={[
                  styles.barFill,
                  { width: barAnim.interpolate({ inputRange: [0, 100], outputRange: ['4%', '100%'] }) },
                ]}
              >
                <LinearGradient
                  colors={[colors.brand, colors.peach]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </View>
            <Text style={styles.statusHint}>
              {setupDone
                ? "You're fully set up and protected."
                : `Just ${total - doneCount} step${total - doneCount > 1 ? 's' : ''} to full protection. Tap to finish.`}
            </Text>
          </Pressable>

          {/* B. Circle */}
          <View style={styles.sectionHRow}>
            <Text style={styles.sectionH}>{selectedCircleName}</Text>
            {members.length > 0 ? (
              <Pressable
                onPress={() => navigation.navigate('CircleMap')}
                style={({ pressed }) => [styles.liveLink, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Ionicons name="map" size={13} color={colors.brandDeep} />
                <Text style={styles.liveLinkText}>Live map</Text>
              </Pressable>
            ) : null}
          </View>
          {members.length === 0 ? (
            <Pressable onPress={() => navigation.navigate('Circles')} style={({ pressed }) => [styles.emptyCircle, pressed && styles.pressed]}>
              <View style={styles.emptyCircleIcon}>
                <Ionicons name="people" size={22} color={colors.brandDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.emptyCircleTitle}>Build your safety circle</Text>
                <Text style={styles.emptyCircleBody}>
                  Add family or friends. The instant you fire an SOS, they all get your live location at once.
                </Text>
              </View>
              <View style={styles.emptyCircleCta}>
                <Ionicons name="add" size={20} color={colors.textInverse} />
              </View>
            </Pressable>
          ) : (
            <View style={styles.card}>
              {members.map((m, i) => (
                <Pressable
                  key={m.uid}
                  onPress={() => navigation.navigate('CircleMap')}
                  style={({ pressed }) => [styles.memberRow, i > 0 && styles.rowDivider, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`See ${m.name} on the live map`}
                >
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
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 4 }} />
                </Pressable>
              ))}
            </View>
          )}

          {/* B2. Recent activity.
              Was rendering raw crossings, which all read identically because
              the member name was fetched and then never displayed: four rows of
              "Arrived at Home" with no indication of WHO, which is exactly why
              it looked hardcoded. Now shows visits, paired enter/exit with a
              duration, and each row opens the full detail. */}
          {visits.length > 0 ? (
            <>
              <View style={styles.activityHead}>
                <Text style={styles.sectionH}>Recent activity</Text>
                {visits.length > 4 ? (
                  <Text style={styles.activityCount}>{visits.length}</Text>
                ) : null}
              </View>
              <View style={styles.card}>
                {visits.slice(0, 4).map((v, i) => {
                  const ongoing = v.leftAt == null;
                  return (
                    <Pressable
                      key={v.id}
                      onPress={() => navigation.navigate('ActivityDetail', { visit: v })}
                      style={({ pressed }) => [
                        styles.activityRow,
                        i > 0 && styles.rowDivider,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${v.memberName ?? 'A circle member'} ${
                        ongoing ? 'is at' : 'visited'
                      } ${v.zoneLabel}. Tap for details.`}
                    >
                      <View
                        style={[
                          styles.activityIcon,
                          { backgroundColor: ongoing ? colors.sageSoft : colors.creamDeep },
                        ]}
                      >
                        <Ionicons
                          name={ongoing ? 'location' : 'time-outline'}
                          size={17}
                          color={ongoing ? colors.sageDeep : colors.brandDeep}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.activityText} numberOfLines={1}>
                          <Text style={styles.activityPlace}>
                            {v.memberName ?? 'A circle member'}
                          </Text>
                          {ongoing ? ' is at ' : ' visited '}
                          <Text style={styles.activityPlace}>{v.zoneLabel}</Text>
                        </Text>
                        <Text style={styles.activitySub}>
                          {ongoing ? 'There for ' : 'Stayed '}
                          {formatDuration(v.durationS)}
                          {v.authorized === false ? '  ·  Flagged' : ''}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                  );
                })}
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
            <GridTile icon="map-outline" title="Circle map" sub="See your people live" onPress={() => navigation.navigate('CircleMap')} />
            <GridTile icon="locate-outline" title="Geofencing" sub="Alert if they leave an area" onPress={() => navigation.navigate('ZoneEditor')} />
            <GridTile icon="warning-outline" title="Disaster mode" sub="Reach people offline" onPress={() => navigation.navigate('DisasterMode')} />
            <GridTile icon="chatbubbles-outline" title="Community" sub="Share & support" onPress={() => navigation.navigate('CommunityFeed')} />
            <GridTile icon="navigate-outline" title="Location sharing" sub="Send your spot" onPress={onShare} />
            <GridTile icon="recording-outline" title="Record evidence" sub="Your recordings" onPress={() => navigation.navigate('Recordings')} />
          </View>
        </ScrollView>
      </Animated.View>
      <CircleSwitcher
        visible={switcherOpen}
        circles={circles}
        selectedId={selectedCircle}
        onSelect={setSelectedCircle}
        onCreate={() => navigation.navigate('CircleCreate')}
        onClose={() => setSwitcherOpen(false)}
      />
      <VoiceDurationSheet
        visible={durationOpen}
        onConfirm={onPickDuration}
        onCancel={() => setDurationOpen(false)}
      />
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
    // Space-between, not a shared bar. Each control now carries its own glass
    // and sizes to its own content.
    justifyContent: 'space-between',
    gap: spacing.sm,
    zIndex: 5,
    // NO background here any more.
    //
    // This used to be one translucent capsule spanning the full width with the
    // three controls inside it. That bar was ~92% of the screen width, so it
    // read as a solid header rather than as floating controls, and it hid a
    // strip of the map that is the most useful thing on this screen.
    //
    // Three separate pills, each only as wide as it needs to be, let the map
    // show through between them and make each control look tappable in its own
    // right instead of like a segment of a toolbar.
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
  // Sits on the rim of the 42px glass button, not inside its old 40px box.
  ctlDot: { position: 'absolute', top: 1, right: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.coral, borderWidth: 2, borderColor: colors.surface },
  // Was flex: 1, which made the circle switcher eat every pixel the two icon
  // buttons did not. It now sizes to its label and simply stops growing past
  // the point where it would crowd the notification button.
  topBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switcherSlot: { flexShrink: 1, alignItems: 'center' },
  activityHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activityCount: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textMuted },
  activitySub: { fontFamily: fontFamilies.interRegular, fontSize: 12.5, color: colors.textSecondary, marginTop: 1 },
  ctlStack: { flexDirection: 'row', gap: spacing.sm },
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
  coverageRow: { marginBottom: spacing.md },
  sheetScroll: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },

  shareState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
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

  statusCard: {
    backgroundColor: colors.brandSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: '#2D2D3D',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statusTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textSecondary },
  statusPct: { fontFamily: fontFamilies.poppinsBold, fontSize: 23, color: colors.brandDeep, letterSpacing: -0.5 },
  bar: { height: 9, borderRadius: 5, backgroundColor: colors.surface, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5, backgroundColor: colors.brand },
  statusHint: { ...typography.caption, fontSize: 12, color: colors.textSecondary },

  sectionHRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  liveLink: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: colors.brandSoft,
  },
  liveLinkText: {
    fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.brandDeep,
  },
  sectionH: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.textPrimary, letterSpacing: -0.3 },
  emptyCircle: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, ...shadows.card,
  },
  emptyCircleIcon: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brandSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyCircleTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textPrimary },
  emptyCircleBody: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  emptyCircleCta: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandDeep,
    alignItems: 'center', justifyContent: 'center',
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
