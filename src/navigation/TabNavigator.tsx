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
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { HomeScreen } from '@/screens/Home/HomeScreen';
import { EmergencyScreen } from '@/screens/Emergency/EmergencyScreen';
import { CommunityFeedScreen } from '@/screens/Community/CommunityFeedScreen';
import { ProfileScreen } from '@/screens/Profile/ProfileScreen';
import { MissionsScreen } from '@/responder/MissionsScreen';
import { useIsResponder } from '@/services/roles';
import { colors, fontFamilies } from '@/theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const ICONS: Partial<Record<
  keyof TabParamList,
  { active: IoniconsName; inactive: IoniconsName; label: string }
>> = {
  Home: { active: 'home', inactive: 'home-outline', label: 'Home' },
  Emergency: {
    active: 'shield-checkmark',
    inactive: 'shield-checkmark-outline',
    label: 'Emergency',
  },
  Community: { active: 'chatbubbles', inactive: 'chatbubbles-outline', label: 'Community' },
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
      <Tab.Screen name="Emergency" component={EmergencyScreen} />
      <Tab.Screen name="Community" component={CommunityFeedScreen} />
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

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      {/* Raised centre: ORBII Plus */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          navigation.navigate('PremiumUpgrade' as never);
        }}
        style={styles.fabWrap}
        accessibilityRole="button"
        accessibilityLabel="ORBII Plus, upgrade"
      >
        <LinearGradient
          colors={[colors.brand, colors.brandDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <Ionicons name="sparkles" size={24} color={colors.textInverse} />
        </LinearGradient>
        <Text style={styles.fabLabel}>Plus</Text>
      </Pressable>

      <View style={styles.bar}>
        <View style={styles.side}>{left.map(renderItem)}</View>
        <View style={styles.centerGap} />
        <View style={styles.side}>{right.map(renderItem)}</View>
      </View>
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
      <Animated.View style={[styles.itemInner, { transform: [{ scale: press }] }]}>
        <Animated.View style={{ transform: [{ translateY: iconLift }] }}>
          <Ionicons name={icon} size={22} color={focused ? colors.brandDeep : colors.textMuted} />
        </Animated.View>
        <Text
          style={[
            styles.itemLabel,
            {
              color: focused ? colors.brandDeep : colors.textMuted,
              fontFamily: focused ? fontFamilies.poppinsBold : fontFamilies.poppinsSemiBold,
            },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
    paddingTop: 9,
    paddingBottom: 8,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    shadowColor: '#2D2D3D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 22,
    elevation: 8,
  },
  side: { flex: 1, flexDirection: 'row' },
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
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  fabLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    color: colors.brandDeep,
    marginTop: 2,
  },
  item: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  itemInner: { alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 4 },
  itemLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10, letterSpacing: 0.2 },
});
