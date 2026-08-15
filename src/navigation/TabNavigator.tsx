import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { HomeScreen } from '@/screens/Home/HomeScreen';
import { EmergencyScreen } from '@/screens/Emergency/EmergencyScreen';
import { CommunityFeedScreen } from '@/screens/Community/CommunityFeedScreen';
import { ProfileScreen } from '@/screens/Profile/ProfileScreen';
import { useEntitlement } from '@/services/entitlements';
import { appAlert, PremiumLock } from '@/components/common';
import { shareMyLocation } from '@/services/location-share';
import { trackEvent } from '@/services/analytics';
import { colors, fontFamilies } from '@/theme';
import { TabBarVisibilityProvider, useTabBarHiddenValue } from './tabBarVisibility';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

// The centre button is NOT a tab, it's the raised SOS panic button. Everything
// else is a side item. "Emergency" is the full safety toolbox, shown as the
// "Safety" side tab; the centre is reserved for the one action she needs fast.
const ICONS: Partial<Record<
  keyof TabParamList,
  { active: IoniconsName; inactive: IoniconsName; label: string }
>> = {
  Home: { active: 'home', inactive: 'home-outline', label: 'Home' },
  Community: { active: 'chatbubbles', inactive: 'chatbubbles-outline', label: 'Community' },
  Emergency: { active: 'shield', inactive: 'shield-outline', label: 'Safety' },
  Profile: { active: 'person', inactive: 'person-outline', label: 'Profile' },
};

// ORBII Community is a Plus feature: a free user sees the unlock screen on the tab.
function GatedCommunity() {
  const ok = useEntitlement('community');
  if (!ok) {
    return (
      <PremiumLock
        feature="ORBII Community"
        icon="chatbubbles"
        blurb="A moderated, anonymous space to share safety experiences, ask for advice, and look out for each other. Unlock it with ORBII Plus."
      />
    );
  }
  return <CommunityFeedScreen />;
}

export function TabNavigator() {
  // Responder Missions moved to Profile, so the bar is a clean 4 tabs (Home,
  // Community, Safety, Profile) around the centre SOS button.
  return (
    <TabBarVisibilityProvider>
      <Tab.Navigator
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          lazy: false,
          sceneStyle: { backgroundColor: colors.cream },
        }}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Community" component={GatedCommunity} />
        <Tab.Screen name="Emergency" component={EmergencyScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </TabBarVisibilityProvider>
  );
}

// Floating bar with a RAISED centre SOS button. The real tabs split around it.
// Tapping the centre opens a sheet of fast, real actions; HOLDING it fires an
// SOS immediately (into the cancelable countdown). This is the panic-proof
// pattern: a stray tap only ever opens options, never sends an alert.
function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 12);
  const [sheet, setSheet] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Retract on scroll down, spring back on scroll up.
  const hidden = useTabBarHiddenValue();
  const translateY = hidden.interpolate({ inputRange: [0, 1], outputRange: [0, 130] });
  const barOpacity = hidden.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  // Keep the bar reachable. If it was retracted (scrolled down) when the app was
  // sent to the background, it would come back still hidden off-screen and you
  // couldn't reach it. Force it visible whenever the app resumes and whenever the
  // active tab changes.
  useEffect(() => {
    const show = () => {
      hidden.stopAnimation();
      Animated.spring(hidden, {
        toValue: 0,
        useNativeDriver: true,
        damping: 18,
        stiffness: 200,
        mass: 0.6,
      }).start();
    };
    show();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') show();
    });
    return () => sub.remove();
  }, [hidden, state.index]);

  const items = state.routes
    .map((route, index) => ({ route, index, meta: ICONS[route.name as keyof TabParamList] }))
    .filter((r) => r.meta);

  // Split the tabs evenly around the centre button.
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);

  const press = (route: (typeof items)[number]['route'], index: number) => {
    const focused = state.index === index;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) {
      Haptics.selectionAsync().catch(() => undefined);
      navigation.navigate(route.name as never);
    }
  };

  const renderItem = ({ route, index, meta }: (typeof items)[number]) => {
    const focused = state.index === index;
    return (
      <TabItem
        key={route.key}
        focused={focused}
        icon={meta!.inactive}
        onPress={() => press(route, index)}
        accessibilityLabel={
          descriptors[route.key].options.tabBarAccessibilityLabel ?? meta!.label
        }
      />
    );
  };

  // HOLD → fire SOS. The countdown screen is the false-alarm guard, so a
  // deliberate ~half-second press is enough; a quick tap can't reach here.
  const fireSOS = () => {
    setSheet(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    trackEvent('sos_from_fab', { via: 'hold' });
    navigation.navigate('SOSCountdown' as never);
  };

  const openSheet = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setSheet(true);
  };

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await shareMyLocation();
      setSheet(false);
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
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom, opacity: barOpacity, transform: [{ translateY }] }]}
    >
      {/* Raised centre: tap opens the Disaster / emergency hub, hold fires an
          instant SOS (that critical gesture stays). */}
      <Pressable
        onPress={() => navigation.navigate('DisasterMode' as never)}
        onLongPress={fireSOS}
        delayLongPress={550}
        style={styles.fabWrap}
        accessibilityRole="button"
        accessibilityLabel="Emergency. Tap for disaster mode and helplines, hold to send an SOS now."
      >
        <LinearGradient
          colors={[colors.coral, colors.coralDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <Ionicons name="warning" size={28} color={colors.textInverse} />
        </LinearGradient>
      </Pressable>

      <BlurView intensity={40} tint="light" style={styles.bar}>
        <View style={styles.side}>{left.map(renderItem)}</View>
        <View style={styles.centerGap} />
        <View style={styles.side}>{right.map(renderItem)}</View>
      </BlurView>

      <SOSActionSheet
        visible={sheet}
        sharing={sharing}
        onClose={() => setSheet(false)}
        onSOS={fireSOS}
        onShare={onShare}
        onCall={() => {
          setSheet(false);
          Linking.openURL('tel:112').catch(() => undefined);
          trackEvent('sos_dialed_112', { from: 'fab_sheet' });
        }}
        onTools={() => {
          setSheet(false);
          navigation.navigate('Emergency' as never);
        }}
      />
    </Animated.View>
  );
}

// The quick-action sheet the centre button opens on a tap. Every action here is
// real and does exactly what it says, nothing decorative on the emergency path.
function SOSActionSheet({
  visible,
  sharing,
  onClose,
  onSOS,
  onShare,
  onCall,
  onTools,
}: {
  visible: boolean;
  sharing: boolean;
  onClose: () => void;
  onSOS: () => void;
  onShare: () => void;
  onCall: () => void;
  onTools: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => undefined}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Get help now</Text>
          <Text style={styles.sheetSub}>Tap what you need. Or hold the SOS button any time.</Text>

          {/* Primary: send the alert. */}
          <Pressable onPress={onSOS} style={({ pressed }) => [styles.sosAction, pressed && styles.pressed]}>
            <View style={styles.sosActionIcon}>
              <Ionicons name="alert" size={22} color={colors.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sosActionTitle}>Send SOS alert</Text>
              <Text style={styles.sosActionSub}>Starts a 10-second countdown you can cancel.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textInverse} />
          </Pressable>

          <ActionRow
            icon="navigate"
            title="Share my location"
            sub="Text your top contact + ping your circle."
            onPress={onShare}
            busy={sharing}
          />
          <ActionRow
            icon="call"
            title="Call 112"
            sub="India's emergency helpline."
            onPress={onCall}
          />
          <ActionRow
            icon="shield-checkmark"
            title="All safety tools"
            sub="Voice SOS, safe journey, check-in timer, more."
            onPress={onTools}
          />

          <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
            <Text style={styles.cancelText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ActionRow({
  icon,
  title,
  sub,
  onPress,
  busy,
}: {
  icon: IoniconsName;
  title: string;
  sub: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={19} color={colors.brandDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{busy ? 'Sharing…' : title}</Text>
        <Text style={styles.actionSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function TabItem({
  focused,
  icon,
  onPress,
  accessibilityLabel,
}: {
  focused: boolean;
  icon: IoniconsName;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const press = useRef(new Animated.Value(1)).current;
  const animatePress = (v: number) =>
    Animated.spring(press, { toValue: v, damping: 15, stiffness: 300, useNativeDriver: true }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => animatePress(0.92)}
      onPressOut={() => animatePress(1)}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel}
      style={styles.item}
    >
      {/* Consistent outlined icons everywhere. The active tab gets a soft
          capsule highlight that hugs the icon (Instagram-style), instead of a
          heavy solid circle. */}
      <Animated.View
        style={[styles.iconWrap, focused && styles.iconWrapOn, { transform: [{ scale: press }] }]}
      >
        <Ionicons name={icon} size={23} color={focused ? colors.brandDeep : colors.textSecondary} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16, alignItems: 'center' },
  pressed: { opacity: 0.92 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    // Frosted glass: translucent fill over the BlurView so the blur reads.
    backgroundColor: 'rgba(255,255,255,0.68)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    overflow: 'hidden',
    shadowColor: '#2D2D3D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 22,
    elevation: 8,
  },
  side: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  centerGap: { width: 72 },
  fabWrap: {
    position: 'absolute',
    top: -26,
    alignItems: 'center',
    zIndex: 10,
  },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.cream,
    shadowColor: colors.coral,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
  },
  fabLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    color: colors.coralDeep,
    marginTop: 2,
  },
  item: { alignItems: 'center', justifyContent: 'center' },
  // Soft capsule that hugs the active icon (Instagram-style), not a heavy circle.
  iconWrap: { minWidth: 52, height: 38, paddingHorizontal: 15, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  iconWrapOn: { backgroundColor: colors.brandSoft },

  // ── SOS action sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  sheetTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    color: colors.textPrimary,
  },
  sheetSub: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: -4,
    marginBottom: 4,
  },
  sosAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.coral,
    borderRadius: 18,
    padding: 16,
  },
  sosActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosActionTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textInverse },
  sosActionSub: { fontFamily: fontFamilies.poppinsRegular, fontSize: 11.5, color: colors.textInverse, opacity: 0.95, marginTop: 1 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.creamDeep,
    borderRadius: 16,
    padding: 14,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  actionSub: { fontFamily: fontFamilies.poppinsRegular, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
  cancelText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textMuted },
});
