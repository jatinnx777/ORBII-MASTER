import registerRootComponent from 'expo/src/launch/registerRootComponent';
import { AppRegistry } from 'react-native';

import App from './App';
import { sosDispatchTask } from './src/services/sos-headless';

// Root React component (same as Expo's default AppEntry).
registerRootComponent(App);

// Headless Voice-SOS dispatch. Started by the native VoiceGuardService when its
// cancel countdown expires, so the alert fires with the screen locked / app
// killed (no UI). Must match the task name used in SosDispatchTaskService.kt.
AppRegistry.registerHeadlessTask('OrbiiSOSDispatch', () => sosDispatchTask);
