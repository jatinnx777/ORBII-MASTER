import { NativeModules, Platform } from 'react-native';
import { getItem, setItem, storageKeys } from '@/services/storage';
import {
  loadBgVoiceState,
  startBackgroundVoice,
  stopBackgroundVoice,
} from '@/services/background-voice';
import { getStatus, startListening, stopListening } from '@/services/voice-detection';
import { loadPhrases } from '@/services/voice-phrases';

// Voice SOS language handling.
//
// English ships INSIDE the app (bundled Vosk model) and is always available.
// Hindi is an OPTIONAL on-demand language pack — downloaded + unpacked into
// private storage by the native side only if the user opts in. Keeping Hindi
// out of the APK is what holds the base download small; English-only users
// never download it and the engine never allocates a Hindi recognizer.

const { VoiceGuard } = NativeModules as {
  VoiceGuard?: {
    isHindiModelReady(): Promise<boolean>;
    downloadHindiModel(): Promise<boolean>;
    getModelDownloadProgress(): Promise<number>;
    deleteHindiModel(): Promise<boolean>;
  };
};

const supported = Platform.OS === 'android' && !!VoiceGuard;

export type VoiceLangPref = {
  /** English is always on. This flag tracks the optional Hindi pack. */
  hindi: boolean;
};

// Shown in the language-setup UI before the user commits to the download.
export const HINDI_PACK = {
  downloadMb: 43, // compressed download over the network
  storageMb: 80, // unpacked size kept on the device
};

export function hindiPackSupported(): boolean {
  return supported;
}

export async function getVoiceLang(): Promise<VoiceLangPref> {
  return (await getItem<VoiceLangPref>(storageKeys.voiceLang)) ?? { hindi: false };
}

export async function setVoiceLang(pref: VoiceLangPref): Promise<void> {
  await setItem(storageKeys.voiceLang, pref);
}

/** Whether the Hindi pack is downloaded + unpacked on this device. */
export async function isHindiReady(): Promise<boolean> {
  if (!supported) return false;
  try {
    return await VoiceGuard!.isHindiModelReady();
  } catch {
    return false;
  }
}

/**
 * Download + unpack the Hindi language pack, reporting 0–100 progress. Resolves
 * true on success. The native side does the actual work on a background thread;
 * we poll its progress so we don't depend on the RN event emitter.
 */
export async function downloadHindiPack(
  onProgress?: (pct: number) => void,
): Promise<boolean> {
  if (!supported) return false;

  let polling = true;
  const pump = async () => {
    while (polling) {
      try {
        const p = await VoiceGuard!.getModelDownloadProgress();
        if (p < 0) break; // error
        onProgress?.(Math.min(99, Math.max(0, p)));
        if (p >= 100) break;
      } catch {
        // keep polling
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  };
  void pump();

  try {
    const ok = await VoiceGuard!.downloadHindiModel();
    polling = false;
    if (ok) {
      await setVoiceLang({ hindi: true });
      onProgress?.(100);
      await reloadEngineIfRunning();
    }
    return ok;
  } catch {
    polling = false;
    return false;
  }
}

/** Remove the Hindi pack and free its storage. */
export async function removeHindiPack(): Promise<void> {
  if (supported) {
    try {
      await VoiceGuard!.deleteHindiModel();
    } catch {
      // ignore
    }
  }
  await setVoiceLang({ hindi: false });
  await reloadEngineIfRunning();
}

// After the model set changes, bounce any running engine so it reloads with
// the new languages. No-op when nothing is listening (e.g. during onboarding).
async function reloadEngineIfRunning(): Promise<void> {
  try {
    const bg = await loadBgVoiceState();
    if (bg.enabled) {
      const phrases = await loadPhrases();
      await stopBackgroundVoice();
      await startBackgroundVoice(phrases, bg.hours);
      return; // background owns the service; don't double-bounce
    }
  } catch {
    // ignore
  }
  if (getStatus() === 'listening') {
    await stopListening();
    await startListening();
  }
}
