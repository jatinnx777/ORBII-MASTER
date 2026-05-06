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
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '@/screens/Home/HomeScreen';
import { SafetyScreen } from '@/screens/Safety/SafetyScreen';
import { PremiumUpgradeScreen } from '@/screens/Premium/PremiumUpgradeScreen';
import { SettingsScreen } from '@/screens/Settings/SettingsScreen';
import { colors, fontFamilies } from '@/theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const ICONS: Record<
  keyof TabParamList,
  { active: IoniconsName; inactive: IoniconsName; label: string }
> = {
  Home: { active: 'home', inactive: 'home-outline', label: 'Home' },
  Safety: {
    active: 'shield-checkmark',
    inactive: 'shield-checkmark-outline',
    label: 'Safety',
  },
  Membership: { active: 'ribbon', inactive: 'ribbon-outline', label: 'Plans' },
  Settings: {
    active: 'settings',
    inactive: 'settings-outline',
    label: 'Settings',
  },
};

export function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Safety" component={SafetyScreen} />
      <Tab.Screen name="Membership" component={PremiumUpgradeScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
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

  const pillScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });
  const pillOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const labelOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });

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
      onPressIn={() => animatePress(0.9)}
      onPressOut={() => animatePress(1)}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel}
      style={styles.itemPressable}
    >
      <Animated.View style={[styles.itemInner, { transform: [{ scale: press }] }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.itemActiveDot,
            {
              opacity: pillOpacity,
              transform: [{ scale: pillScale }],
            },
          ]}
        />
        <Ionicons
          name={icon}
          size={22}
          color={focused ? colors.brandDeep : colors.textMuted}
        />
        <Animated.Text
          style={[
            styles.itemLabel,
            {
              color: focused ? colors.brandDeep : colors.textMuted,
              opacity: labelOpacity,
            },
          ]}
          numberOfLines={1}
        >
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    alignItems: 'stretch',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.background,
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 28,
    shadowColor: '#0F1115',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(86,197,150,0.10)',
  },
  itemPressable: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  // Single-purpose 4 px dot under each tab icon, animated via scale +
  // opacity. Constrained to its own item cell so it cannot bleed onto
  // neighbours like the previous expanding-label pill did.
  itemActiveDot: {
    position: 'absolute',
    bottom: -6,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.brandDeep,
  },
  itemLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 10,
    letterSpacing: 0.3,
    marginTop: 1,
  },
});
