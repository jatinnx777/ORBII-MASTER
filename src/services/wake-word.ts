// Compatibility shim. The wake-word implementation moved to
// `src/services/wake-word/` so we can swap engines without touching
// callsites. Keep this file only as a re-export.

export {
  BUILTIN_KEYWORDS,
  isVoiceNativeAvailable,
  startBackgroundVoice,
  canAutoStartVoice,
  type BuiltinKeyword,
  type StartBackgroundVoiceArgs,
} from './wake-word/index';
