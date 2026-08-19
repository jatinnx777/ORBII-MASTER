import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Node-environment tests only, and deliberately so.
//
// This project has no test suite, so the first ones need to earn their keep
// rather than chase coverage. Everything here is a PURE function on a
// safety-critical path: age gating, SOS escalation timing, distress-trail
// analysis, and the community ranking maths. No React, no native modules, no
// Supabase, so nothing needs mocking and nothing is flaky.
//
// Component and integration tests are a separate job needing jsdom and a
// React Native preset. Not doing them here is a scope decision, not an
// oversight.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // See test/stubs/react-native.ts for why these exist.
      'react-native': path.resolve(__dirname, 'test/stubs/react-native.ts'),
      '@react-native-async-storage/async-storage': path.resolve(__dirname, 'test/stubs/empty.ts'),
      'expo-location': path.resolve(__dirname, 'test/stubs/empty.ts'),
      'expo-notifications': path.resolve(__dirname, 'test/stubs/empty.ts'),
      'expo-task-manager': path.resolve(__dirname, 'test/stubs/task-manager.ts'),
      // supabase.ts pulls react-native-url-polyfill, which is Flow-typed too.
      './supabase': path.resolve(__dirname, 'test/stubs/empty.ts'),
      '@/services/supabase': path.resolve(__dirname, 'test/stubs/empty.ts'),
    },
  },
});
