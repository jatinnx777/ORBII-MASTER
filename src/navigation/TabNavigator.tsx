import React, { useEffect, useRef } from 'react';
import {
  Animated,
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
import { PremiumUpgradeScreen } from '@/screens/Premium/PremiumUpgradeScreen';
import { ProfileScreen } from '@/screens/Profile/ProfileScreen';
import { MissionsScreen } from '@/responder/MissionsScreen';
import { useIsResponder } from '@/services/roles';
import { colors, fontFamilies } from '@/theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

// Emergency is deliberately NOT here — it's the raised centre button, not a
// side item.
const ICONS: Partial<Record<
  keyof TabParamList,
  { active: IoniconsName; inactive: IoniconsName; label: string }
>> = {
  Home: { active: 'home', inactive: 'home-outline', label: 'Home' },
  Community: { active: 'chatbubbles', inactive: 'chatbubbles-outline', label: 'Community' },
  Plus: { active: 'sparkles', inactive: 'sparkles-outline', label: 'Plus' },
  Missions: { active: 'flash', inactive: 'flash-outline', label: 'Missions' },
  Profile: { active: 'person', inactive: 'person-outline', label: 'Profile' },
};

export function TabNavigator() {
  const showMissions = useIsResponder();
  return (
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
      <Tab.Screen name="Community" component={CommunityFeedScreen} />
      <Tab.Screen name="Emergency" component={EmergencyScreen} />
      <Tab.Screen name="Plus" component={PremiumUpgradeScreen} />
      {showMissions ? <Tab.Screen name="Missions" component={MissionsScreen} /> : null}
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// Floating bar with a RAISED centre button — ORBII Plus. The real tabs split
// around it, and tapping the centre opens the upgrade screen.
function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 12);

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
        icon={focused ? meta!.active : meta!.inactive}
        label={meta!.label}
        onPress={() => press(route, index)}
        accessibilityLabel={
          descriptors[route.key].options.tabBarAccessibilityLabel ?? meta!.label
        }
      />
    );
  };

  const emergencyFocused = state.routes[state.index]?.name === 'Emergency';

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      {/* Raised centre: EMERGENCY — the one button she must always find fast. */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
          navigation.navigate('Emergency' as never);
        }}
        style={styles.fabWrap}
        accessibilityRole="button"
        accessibilityLabel="Emergency"
      >
        <LinearGradient
          colors={[colors.coral, colors.coralDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fab, emergencyFocused && styles.fabOn]}
        >
          <Ionicons name="shield-checkmark" size={26} color={colors.textInverse} />
        </LinearGradient>
        <Text style={styles.fabLabel}>Emergency</Text>
      </Pressable>

      <BlurView intensity={40} tint="light" style={styles.bar}>
        <View style={styles.side}>{left.map(renderItem)}</View>
        <View style={styles.centerGap} />
        <View style={styles.side}>{right.map(renderItem)}</View>
      </BlurView>
    </View>
  );
}

function TabItem({
  focused,
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  focused: boolean;
  icon: IoniconsName;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const press = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(lift, { toValue: focused ? 1 : 0, damping: 18, stiffness: 200, useNativeDriver: true }).start();
  }, [focused, lift]);

  const iconLift = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  const animatePress = (v: number) =>
    Animated.spring(press, { toValue: v, damping: 15, stiffness: 280, useNativeDriver: true }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => animatePress(0.9)}
      onPressOut={() => animatePress(1)}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel}
      style={styles.item}
    >
      {/* Icon-only. The active tab gets a filled brand circle behind it — the
          circular active-state indicator. No labels, so nothing can overflow
          its slot or collide with the centre button. */}
      <Animated.View
        style={[
          styles.iconPill,
          focused && styles.iconPillOn,
          { transform: [{ scale: press }, { translateY: iconLift }] },
        ]}
      >
        <Ionicons name={icon} size={22} color={focused ? colors.textInverse : colors.textMuted} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    // Frosted glass: translucent fill over the BlurView so the blur reads.
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    overflow: 'hidden',
    shadowColor: '#2D2D3D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 22,
    elevation: 8,
  },
  side: { flex: 1, flexDirection: 'row', justifyContent: 'space-evenly' },
  centerGap: { width: 76 },
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
  fabOn: { borderColor: colors.coralSoft },
  fabLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    color: colors.coralDeep,
    marginTop: 2,
  },
  item: { alignItems: 'center', justifyContent: 'center' },
  iconPill: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  iconPillOn: { backgroundColor: colors.brand },
});
