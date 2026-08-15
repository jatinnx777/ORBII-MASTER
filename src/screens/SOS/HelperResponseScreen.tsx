import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MLMapView, type MLMarker } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import type { AppStackParamList } from '@/navigation/types';
import type { GeoPoint } from '@/types';

// Victim-facing "Help is on the way" screen, the calm, premium moment right
// after a helper accepts the SOS. Soft-minimal (Blinkit / Uber / Google Maps),
// entirely in ORBII green so it reads as reassurance, never alarm. Red is used
// only for the two genuinely-danger actions (Exit, Call Police).

type Nav = NativeStackNavigationProp<AppStackParamList>;
type Params = RouteProp<AppStackParamList, 'HelperResponse'>;

const STAGES = ['Accepted', 'Driving', 'Nearby', 'Reached', 'Safe'] as const;

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km away` : `${Math.round(m)} m away`;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function HelperResponseScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Params>();

  const name = params?.name?.trim() || 'Your helper';
  const phone = params?.phone ?? null;
  const vehicle = params?.vehicle ?? 'On the way';
  const startEta = params?.etaMin ?? 4;
  const startDist = params?.distanceM ?? 650;

  const victim: GeoPoint | null =
    params?.victimLat != null && params?.victimLng != null
      ? { latitude: params.victimLat, longitude: params.victimLng }
      : null;
  const helper: GeoPoint | null =
    params?.helperLat != null && params?.helperLng != null
      ? { latitude: params.helperLat, longitude: params.helperLng }
      : null;

  const [etaMin, setEtaMin] = useState(startEta);
  const [sharing, setSharing] = useState(true);
  const [showHelper, setShowHelper] = useState(true);
  const [showAddress, setShowAddress] = useState(false);

  // Gentle ETA countdown so the wait feels alive. Real ETA replaces this once
  // live helper tracking is wired; the display never blocks the SOS itself.
  useEffect(() => {
    if (etaMin <= 0) return;
    const id = setInterval(() => setEtaMin((m) => Math.max(0, m - 1)), 60_000);
    return () => clearInterval(id);
  }, [etaMin]);

  const stage = useMemo(() => {
    if (etaMin <= 0) return 3; // Reached
    if (etaMin <= 1) return 2; // Nearby
    if (etaMin >= startEta) return 1; // Driving (just accepted → moving)
    return 1;
  }, [etaMin, startEta]);

  const statusText = ['Helper accepted your SOS', 'Heading towards you', 'Reached nearby', 'Waiting outside for you', "You're safe now"][stage];
  const statusSub = [`${name} is starting towards you`, `${name} is driving to your location`, 'Almost there, stay where you are', `${name} has arrived`, 'Stay with your helper'][stage];

  // sonar ripple on the status icon
  const ripple = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(ripple, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [ripple]);

  const markers: MLMarker[] = useMemo(() => {
    const arr: MLMarker[] = [];
    if (victim) arr.push({ id: 'you', coordinate: victim, kind: 'user' });
    if (helper) arr.push({ id: 'helper', coordinate: helper, kind: 'helper-verified' });
    return arr;
  }, [victim, helper]);

  const call = (num: string | null) => {
    if (num) Linking.openURL(`tel:${num}`).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      {/* ── Green header ── */}
      <LinearGradient
        colors={[colors.sage, colors.sageDeep]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.headTop}>
            <Pressable onPress={() => navigation.goBack()} style={styles.headBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color={colors.sageDeep} />
            </Pressable>
            <View style={styles.headBtn}>
              <Ionicons name="shield-checkmark" size={20} color={colors.sageDeep} />
            </View>
          </View>
          <View style={styles.headEyebrowRow}>
            <View style={styles.liveDot} />
            <Text style={styles.headEyebrow}>Emergency accepted</Text>
          </View>
          <Text style={styles.headTitle}>Helper is on the way</Text>
          <Text style={styles.headSub}>
            {etaMin > 0 ? `Arriving in ${etaMin} minute${etaMin === 1 ? '' : 's'}` : 'Arriving now'}
          </Text>
          <View style={styles.chipRow}>
            <View style={styles.chip}>
              <Ionicons name="checkmark-circle" size={13} color="#fff" />
              <Text style={styles.chipText}>Verified Helper</Text>
            </View>
            <View style={styles.chip}>
              <View style={styles.liveDot} />
              <Text style={styles.chipText}>Live Tracking</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Map ── */}
        <View style={styles.mapCard}>
          {markers.length > 0 ? (
            <MLMapView
              style={styles.map}
              markers={markers}
              center={victim ?? helper ?? undefined}
              fitAll={markers.length > 1}
              zoom={15}
              interactive
            />
          ) : (
            <View style={[styles.map, styles.mapEmpty]}>
              <Ionicons name="navigate-circle-outline" size={30} color={colors.sageDeep} />
              <Text style={styles.mapEmptyText}>Locating your helper…</Text>
            </View>
          )}
          <Pressable style={[styles.mapBtn, styles.mapExit]} onPress={() => navigation.goBack()} hitSlop={6}>
            <Ionicons name="close" size={20} color={colors.coral} />
          </Pressable>
          <View style={styles.mapBadge}>
            <View style={[styles.liveDot, { backgroundColor: colors.sage }]} />
            <Text style={styles.mapBadgeText}>{fmtDistance(startDist)}</Text>
          </View>
        </View>

        {/* ── Map actions ── */}
        <View style={styles.rowGap}>
          <Pressable style={[styles.mAct, styles.mActGhost]} onPress={() => setSharing(true)}>
            <Ionicons name="location" size={18} color={colors.sageDeep} />
            <Text style={styles.mActGhostText}>Share Location</Text>
          </Pressable>
          <Pressable style={[styles.mAct, styles.mActGreen]} onPress={() => call(phone)}>
            <Ionicons name="call" size={18} color="#fff" />
            <Text style={styles.mActGreenText}>Call Helper</Text>
          </Pressable>
        </View>

        {/* ── Helper card ── */}
        <View style={styles.card}>
          <View style={styles.helperTop}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(name) || 'H'}</Text>
              <View style={styles.verify}>
                <Ionicons name="checkmark" size={12} color="#fff" />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.helperName}>{name}</Text>
              <View style={styles.verifiedRow}>
                <Ionicons name="shield-checkmark" size={13} color={colors.sageDeep} />
                <Text style={styles.verifiedText}>Verified Helper</Text>
              </View>
              <Text style={styles.helperSub}>{fmtDistance(startDist)} · {vehicle}</Text>
            </View>
            <View style={styles.etaChip}>
              <Text style={styles.etaLbl}>ETA</Text>
              <Text style={styles.etaVal}>{etaMin > 0 ? `${etaMin}m` : 'Now'}</Text>
            </View>
          </View>
          <View style={styles.rowGap}>
            <Pressable style={[styles.hBtn, styles.hCall]} onPress={() => call(phone)}>
              <Ionicons name="call" size={18} color="#fff" />
              <Text style={styles.hCallText}>Call</Text>
            </Pressable>
            <Pressable style={[styles.hBtn, styles.hMsg]} onPress={() => call(phone)}>
              <Ionicons name="chatbubble-ellipses" size={18} color={colors.textPrimary} />
              <Text style={styles.hMsgText}>Message</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Live status ── */}
        <View style={styles.status}>
          <View style={styles.statusIco}>
            <Animated.View
              style={[
                styles.statusRipple,
                {
                  opacity: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                  transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
                },
              ]}
            />
            <Ionicons name="arrow-forward" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusMain}>{statusText}</Text>
            <Text style={styles.statusSub}>{statusSub}</Text>
          </View>
          <View style={styles.statusLive}>
            <View style={[styles.liveDot, { backgroundColor: colors.sage }]} />
            <Text style={styles.statusLiveText}>Live</Text>
          </View>
        </View>

        {/* ── Timeline ── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Progress</Text>
          <View style={styles.tlTrack}>
            <View style={styles.tlLine} />
            <View style={[styles.tlFill, { width: `${(stage / (STAGES.length - 1)) * 100}%` }]} />
            {STAGES.map((s, i) => (
              <View key={s} style={styles.tlNode}>
                <View
                  style={[
                    styles.tlDot,
                    i < stage && styles.tlDotDone,
                    i === stage && styles.tlDotCurrent,
                  ]}
                />
                <Text style={[styles.tlLabel, i <= stage && styles.tlLabelOn]}>{s}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Share location ── */}
        <View style={styles.card}>
          <View style={styles.shareHead}>
            <View style={styles.shareIco}>
              <Ionicons name="location" size={20} color={colors.sageDeep} />
            </View>
            <Text style={styles.shareH}>Share your exact location</Text>
          </View>
          <Text style={styles.shareDesc}>
            Share precise location only while the helper is coming. It stops
            automatically the moment your emergency ends.
          </Text>
          <View style={styles.rowGap}>
            <Pressable
              style={[styles.shareBtn, sharing && styles.shareBtnOn]}
              onPress={() => setSharing((v) => !v)}
            >
              {sharing ? <View style={styles.pulse} /> : null}
              <Text style={styles.shareBtnText}>
                {sharing ? 'Sharing live location' : 'Share Live Location'}
              </Text>
            </Pressable>
            <Pressable style={styles.stopBtn} onPress={() => setSharing(false)}>
              <Text style={styles.stopText}>Stop</Text>
            </Pressable>
          </View>
          <View style={styles.privacy}>
            <Ionicons name="lock-closed" size={13} color={colors.textMuted} />
            <Text style={styles.privacyText}>
              Encrypted and shared only with your active helper.
            </Text>
          </View>
        </View>

        {/* ── Quick actions ── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Quick actions</Text>
          <View style={styles.qaGrid}>
            <QA icon="call" tint={colors.coralSoft} fg={colors.coralDeep} label="Call Police" onPress={() => call('112')} />
            <QA icon="people" tint={colors.sageSoft} fg={colors.sageDeep} label="Call Family" onPress={() => call(phone)} />
            <QA icon="person-add" tint="#E9F1FE" fg="#2E6FE0" label="Contacts" onPress={() => navigation.navigate('EmergencyContacts')} />
            <QA icon="medkit" tint={colors.goldSoft} fg={colors.goldDeep} label="Medical" onPress={() => navigation.navigate('EditProfile')} />
            <QA icon="flashlight" tint={colors.lavenderSoft} fg={colors.lavenderDeep} label="Flashlight" onPress={() => undefined} />
            <QA icon="megaphone" tint={colors.creamDeep} fg={colors.textSecondary} label="Siren" onPress={() => undefined} />
          </View>
        </View>

        {/* ── Helper details (expandable) ── */}
        <View style={styles.card}>
          <Pressable style={styles.expHead} onPress={() => setShowHelper((v) => !v)}>
            <View style={styles.expIco}>
              <Ionicons name="person" size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.expH}>Helper details</Text>
              <Text style={styles.expHint}>Verified identity & vehicle</Text>
            </View>
            <Ionicons name={showHelper ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
          </Pressable>
          {showHelper ? (
            <View style={styles.rows}>
              <Row k="Phone number" v={phone ?? 'Hidden until you call'} />
              <Row k="Vehicle" v={vehicle} />
              <Row k="Verification" v="ORBII verified responder" />
              <Row k="Rating" v="★ 4.9" />
              <Row k="Completed assists" v=", " />
            </View>
          ) : null}
        </View>

        {/* ── Address (expandable) ── */}
        <View style={styles.card}>
          <View style={styles.grabber} />
          <Pressable style={styles.expHead} onPress={() => setShowAddress((v) => !v)}>
            <View style={styles.expIco}>
              <Ionicons name="location" size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.expH}>Your location</Text>
              <Text style={styles.expHint}>Shared with your helper</Text>
            </View>
            <Ionicons name={showAddress ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
          </Pressable>
          {showAddress ? (
            <View style={styles.rows}>
              <Row
                k="Coordinates"
                v={victim ? `${victim.latitude.toFixed(4)}, ${victim.longitude.toFixed(4)}` : 'Locating…'}
              />
              <Row k="Accuracy" v="Live GPS" />
            </View>
          ) : null}
        </View>

        <Text style={styles.foot}>ORBII stays with you until you tap “I’m safe”.</Text>
      </ScrollView>
    </View>
  );
}

function QA({
  icon,
  tint,
  fg,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  fg: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.qa} onPress={onPress}>
      <View style={[styles.qaIco, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={20} color={fg} />
      </View>
      <Text style={styles.qaName}>{label}</Text>
    </Pressable>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowK}>{k}</Text>
      <Text style={styles.rowV}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
  },
  headTop: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.xs },
  headBtn: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  headEyebrowRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 11, paddingVertical: 5,
    borderRadius: 999, marginTop: spacing.lg,
  },
  headEyebrow: { fontFamily: fontFamilies.poppinsBold, fontSize: 11.5, color: '#fff', letterSpacing: 0.6, textTransform: 'uppercase' },
  headTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 27, color: '#fff', marginTop: spacing.md, letterSpacing: -0.4 },
  headSub: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: '#fff', opacity: 0.95, marginTop: 6 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: spacing.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  chipText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: '#fff' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },

  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },

  mapCard: {
    marginTop: -20, borderRadius: radius.xxl, overflow: 'hidden', backgroundColor: colors.surface,
    ...shadows.card,
  },
  map: { height: 280, width: '100%' },
  mapEmpty: { alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.creamDeep },
  mapEmptyText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.sageDeep },
  mapBtn: {
    position: 'absolute', width: 44, height: 44, borderRadius: 15, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', ...shadows.card,
  },
  mapExit: { top: 14, left: 14 },
  mapBadge: {
    position: 'absolute', left: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#fff', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, ...shadows.icon,
  },
  mapBadgeText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textPrimary },

  rowGap: { flexDirection: 'row', gap: spacing.sm },
  mAct: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    paddingVertical: 15, borderRadius: 20,
  },
  mActGhost: { backgroundColor: colors.surface, ...shadows.icon },
  mActGhostText: { fontFamily: fontFamilies.poppinsBold, fontSize: 14.5, color: colors.textPrimary },
  mActGreen: { backgroundColor: colors.sage, ...shadows.hero },
  mActGreenText: { fontFamily: fontFamilies.poppinsBold, fontSize: 14.5, color: '#fff' },

  card: { backgroundColor: colors.surface, borderRadius: radius.xxl, padding: spacing.lg, gap: spacing.md, ...shadows.card },
  cardLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 12, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.textMuted },

  helperTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 60, height: 60, borderRadius: 20, backgroundColor: colors.sageSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: fontFamilies.poppinsBold, fontSize: 21, color: colors.sageDeep },
  verify: {
    position: 'absolute', right: -5, bottom: -5, width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.sage, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.surface,
  },
  helperName: { fontFamily: fontFamilies.poppinsBold, fontSize: 18.5, color: colors.textPrimary },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  verifiedText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.sageDeep },
  helperSub: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textSecondary, marginTop: 6 },
  etaChip: { backgroundColor: colors.sageSoft, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
  etaLbl: { fontFamily: fontFamilies.poppinsBold, fontSize: 10.5, letterSpacing: 0.6, color: colors.sageDeep },
  etaVal: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.sageDeep },
  hBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 15, borderRadius: 18 },
  hCall: { backgroundColor: colors.sage, ...shadows.hero },
  hCallText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: '#fff' },
  hMsg: { backgroundColor: colors.creamDeep },
  hMsgText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textPrimary },

  status: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.sageSoft, borderRadius: radius.xxl, padding: spacing.lg, ...shadows.card,
  },
  statusIco: {
    width: 48, height: 48, borderRadius: 16, backgroundColor: colors.sage,
    alignItems: 'center', justifyContent: 'center',
  },
  statusRipple: { position: 'absolute', width: 48, height: 48, borderRadius: 16, backgroundColor: colors.sage },
  statusMain: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary },
  statusSub: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  statusLive: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusLiveText: { fontFamily: fontFamilies.poppinsBold, fontSize: 11.5, color: colors.sageDeep, textTransform: 'uppercase', letterSpacing: 0.5 },

  tlTrack: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 6, marginTop: 4 },
  tlLine: { position: 'absolute', top: 9, left: 9, right: 9, height: 3, backgroundColor: colors.creamDeep, borderRadius: 2 },
  tlFill: { position: 'absolute', top: 9, left: 9, height: 3, backgroundColor: colors.sage, borderRadius: 2 },
  tlNode: { alignItems: 'center', gap: 9, width: '20%' },
  tlDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 3, borderColor: colors.creamDeep },
  tlDotDone: { backgroundColor: colors.sage, borderColor: colors.sage },
  tlDotCurrent: { backgroundColor: colors.surface, borderColor: colors.sage },
  tlLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, color: colors.textMuted },
  tlLabelOn: { color: colors.textPrimary },

  shareHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shareIco: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.sageSoft, alignItems: 'center', justifyContent: 'center' },
  shareH: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.textPrimary, flex: 1 },
  shareDesc: { fontFamily: fontFamilies.interRegular, fontSize: 13.5, lineHeight: 20, color: colors.textSecondary },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: colors.sage, paddingVertical: 16, borderRadius: 18, ...shadows.hero },
  shareBtnOn: { backgroundColor: colors.sageDeep },
  shareBtnText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: '#fff' },
  pulse: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#fff' },
  stopBtn: { paddingHorizontal: 18, borderRadius: 18, backgroundColor: colors.creamDeep, alignItems: 'center', justifyContent: 'center' },
  stopText: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.textSecondary },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  privacyText: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textMuted, flex: 1 },

  qaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  qa: { width: '31.5%', alignItems: 'center', gap: 8, paddingVertical: spacing.md, borderRadius: 20, backgroundColor: colors.creamDeep },
  qaIco: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  qaName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.textPrimary },

  expHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  expIco: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.creamDeep, alignItems: 'center', justifyContent: 'center' },
  expH: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary },
  expHint: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  rows: { gap: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.divider },
  rowK: { fontFamily: fontFamilies.interMedium, fontSize: 14, color: colors.textSecondary },
  rowV: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.creamDeep, alignSelf: 'center' },

  foot: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
});
