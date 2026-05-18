import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WelcomeScreen } from '@/screens/Auth/WelcomeScreen';
import { LoginScreen } from '@/screens/Auth/LoginScreen';
import { PhoneSignInScreen } from '@/screens/Auth/PhoneSignInScreen';
import { PhoneVerifyScreen } from '@/screens/Auth/PhoneVerifyScreen';
import { LanguageSelectorScreen } from '@/screens/Auth/LanguageSelectorScreen';
import { ProfileSetupScreen } from '@/screens/Auth/ProfileSetupScreen';
import { useAppSelector } from '@/redux/store';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

// Auth flow:
//   Welcome (first impression — pulse, gradient, three CTAs)
//     ↓ Continue with Google      → OAuth → ProfileSetup or Tabs
//     ↓ "Already have an account" → Login (Welcome back)
//     ↓ Continue with Email       → placeholder alert
//
// If the user comes back with a complete server-side profile but no
// local profile, status flips to needs_profile inside signInWithGoogle
// and the navigator forces ProfileSetup as the initial route.
export function AuthNavigator() {
  const status = useAppSelector((s) => s.user.status);
  const initialRouteName: keyof AuthStackParamList =
    status === 'needs_profile' ? 'ProfileSetup' : 'Welcome';

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#FFFFFF' },
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="PhoneSignIn" component={PhoneSignInScreen} />
      <Stack.Screen name="PhoneVerify" component={PhoneVerifyScreen} />
      <Stack.Screen
        name="LanguageSelector"
        component={LanguageSelectorScreen}
      />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
    </Stack.Navigator>
  );
}
