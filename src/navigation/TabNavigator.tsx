import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { HomeScreen } from '@/screens/Home/HomeScreen';
import { EmergencyScreen } from '@/screens/Emergency/EmergencyScreen';
import { SupportScreen } from '@/screens/Support/SupportScreen';
import { ProfileScreen } from '@/screens/Profile/ProfileScreen';
import { MissionsScreen } from '@/responder/MissionsScreen';
import { useIsResponder } from '@/services/roles';
import { colors, fontFamilies } from '@/theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<
  keyof TabParamList,
  { active: IoniconsName; inactive: IoniconsName; label: string }
> = {
  Home: { active: 'home', inactive: 'home-outline', label: 'Home' },
  Emergency: {
    active: 'shield-checkmark',
    inactive: 'shield-checkmark-outline',
    label: 'Emergency',
  },
  Support: { active: 'heart', inactive: 'heart-outline', label: 'Support' },
  Missions: { active: 'flash', inactive: 'flash-outline', label: 'Missions' },
  Profile: { active: 'person', inactive: 'person-outline', label: 'Profile' },
};

export function TabNavigator() {
  // The Missions tab is permission-driven — only approved responders see it.
  const showMissions = useIsResponder();
  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Built-in fade: interruption-safe, so rapid tab switching never
        // leaves a blank frame (the old custom cross-fade dipped to opacity 0
        // and could strand a screen blank mid-animation).
        animation: 'fade',
        // Keep all tabs mounted so switching back is instant, never a blank.
        lazy: false,
        // Mid-fade neither screen is fully opaque, so whatever sits behind them
        // shows through. Paint it cream instead of letting the native window
        // (black on a phone in dark mode) be what the user sees.
        sceneStyle: { backgroundColor: colors.cream },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Emergency" component={EmergencyScreen} />
      <Tab.Screen name="Support" component={SupportScreen} />
      {showMissions ? (
        <Tab.Screen name="Missions" component={MissionsScreen} />
      ) : null}
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// Floating capsule tab bar. Sits above the screen with bottom inset
// padding, soft shadow, and a smooth scale + opacity animation on the
// active tab. Mint-tinted active pill makes it feel calm and on-brand.
function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 12);

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const meta = ICONS[route.name as keyof TabParamList];
          if (!meta) return null;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              Haptics.selectionAsync().catch(() => undefined);
              navigation.navigate(route.name as never);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          const accessibilityLabel =
            descriptors[route.key].options.tabBarAccessibilityLabel ?? meta.label;

          return (
            <TabItem
              key={route.key}
              focused={focused}
              icon={focused ? meta.active : meta.inactive}
              label={meta.label}
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityLabel={accessibilityLabel}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabItem({
  focused,
  icon,
  label,
  onPress,
  onLongPress,
  accessibilityLabel,
}: {
  focused: boolean;
  icon: IoniconsName;
  label: string;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityLabel: string;
}) {
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      damping: 18,
      stiffness: 200,
      useNativeDriver: false,
    }).start();
  }, [focused, progress]);

  // Clean active state: warm tint + a gentle lift on the icon and a small
  // dot beneath the label. No background pill; the bar stays quiet.
  const iconLift = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  const dotOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const dotScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  const animatePress = (toValue: number) =>
    Animated.spring(press, {
      toValue,
      damping: 15,
      stiffness: 280,
      useNativeDriver: true,
    }).start();

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => animatePress(0.92)}
      onPressOut={() => animatePress(1)}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel}
      style={styles.itemPressable}
    >
      <Animated.View style={[styles.itemInner, { transform: [{ scale: press }] }]}>
        <Animated.View style={{ transform: [{ translateY: iconLift }] }}>
          <Ionicons
            name={icon}
            size={22}
            color={focused ? colors.peachDeep : colors.textMuted}
          />
        </Animated.View>
        <Text
          style={[
            styles.itemLabel,
            {
              color: focused ? colors.peachDeep : colors.textMuted,
              fontFamily: focused ? fontFamilies.poppinsBold : fontFamilies.poppinsSemiBold,
            },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Animated.View
          pointerEvents="none"
          style={[styles.activeDot, { opacity: dotOpacity, transform: [{ scale: dotScale }] }]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    alignItems: 'stretch',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingTop: 9,
    paddingBottom: 8,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    shadowColor: '#2D2D2D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 22,
    elevation: 8,
  },
  itemPressable: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 5,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.peachDeep,
    marginTop: 1,
  },
  itemLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 10.5,
    letterSpacing: 0.2,
  },
});
