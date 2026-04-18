import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '@/screens/Auth/LoginScreen';
import { OTPScreen } from '@/screens/Auth/OTPScreen';
import { ProfileSetupScreen } from '@/screens/Auth/ProfileSetupScreen';
import { useAppSelector } from '@/redux/store';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  const status = useAppSelector((s) => s.user.status);
  const initialRouteName: keyof AuthStackParamList =
    status === 'needs_profile' ? 'ProfileSetup' : 'Login';

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#FFFFFF' },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="OTP" component={OTPScreen} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
    </Stack.Navigator>
  );
}
