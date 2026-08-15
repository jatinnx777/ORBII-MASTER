import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { NativeModules, Platform } from 'react-native';
import { getItem, setItem, storageKeys } from '@/services/storage';
import en from './locales/en.json';
import hi from './locales/hi.json';

// Supported locales. The Welcome / Settings UIs render the localised
// name from `language.names.<code>` and the English label from
// `language.english.<code>` so every label survives a language swap.
export const SUPPORTED_LOCALES = ['en', 'hi', 'pa', 'ta', 'bn'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const FALLBACK: Locale = 'en';

// Until proper translations land for Punjabi / Tamil / Bengali, those
// codes fall back to English content. The selector UI still shows the
// language pill so users can see what's coming.
const resources = {
  en: { translation: en },
  hi: { translation: hi },
  pa: { translation: en },
  ta: { translation: en },
  bn: { translation: en },
} as const;

function detectDeviceLocale(): Locale {
  try {
    if (Platform.OS === 'ios') {
      const tag =
        (NativeModules as Record<string, { AppleLocale?: string; AppleLanguages?: string[] }>)
          ?.SettingsManager?.AppleLocale ??
        (NativeModules as Record<string, { AppleLocale?: string; AppleLanguages?: string[] }>)
          ?.SettingsManager?.AppleLanguages?.[0] ??
        '';
      const code = tag.toLowerCase().split(/[-_]/)[0] as Locale;
      if (SUPPORTED_LOCALES.includes(code)) return code;
    } else if (Platform.OS === 'android') {
      const tag =
        (NativeModules as Record<string, { localeIdentifier?: string }>).I18nManager
          ?.localeIdentifier ?? '';
      const code = tag.toLowerCase().split(/[-_]/)[0] as Locale;
      if (SUPPORTED_LOCALES.includes(code)) return code;
    }
  } catch {
    // ignore, fall back to English.
  }
  return FALLBACK;
}

let initialised = false;

export async function initI18n(): Promise<Locale> {
  const stored = (await getItem<string>(storageKeys.locale)) as Locale | null;
  const initial = stored && SUPPORTED_LOCALES.includes(stored)
    ? stored
    : detectDeviceLocale();
  if (!initialised) {
    await i18next.use(initReactI18next).init({
      compatibilityJSON: 'v4',
      resources,
      lng: initial,
      fallbackLng: FALLBACK,
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    initialised = true;
  } else {
    await i18next.changeLanguage(initial);
  }
  return initial;
}

export async function setLocale(locale: Locale): Promise<void> {
  await setItem<string>(storageKeys.locale, locale);
  await i18next.changeLanguage(locale);
}

export function currentLocale(): Locale {
  const lng = i18next.language as Locale;
  return SUPPORTED_LOCALES.includes(lng) ? lng : FALLBACK;
}

export { i18next };
