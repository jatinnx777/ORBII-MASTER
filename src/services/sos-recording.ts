import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { useEffect, useRef } from 'react';
import { addBreadcrumb, reportError } from './error-reporting';

// SOS audio recorder.
//
// `expo-audio` only exposes recording via the `useAudioRecorder` hook, so we
// wrap it in `useSOSRecorder` and let the ActiveSOS screen drive it: start on
// mount, stop on unmount, and save the clip permanently ON THE DEVICE.
//
// Privacy posture:
//   • Recording starts ONLY when the user has fired a real SOS.
//   • The clip is saved on-device at `<documents>/sos-recordings/<sosId>.m4a`
//     (NOT uploaded anywhere). It shows up in SOS History where the user can
//     play it back or share it with their circle.
//   • If the user cancels before the 60s timer, we stop early and still keep
//     whatever was captured.

const DEFAULT_DURATION_MS = 60_000;
const REC_DIR = 'sos-recordings';

/** Permanent on-device path for an SOS recording (deterministic from sosId). */
export function sosRecordingUri(sosId: string): string {
  const dir = new FileSystem.Directory(FileSystem.Paths.document, REC_DIR);
  return new FileSystem.File(dir, `${sosId}.m4a`).uri;
}

/** Whether a saved recording exists on-device for this SOS. */
export function hasSosRecording(sosId: string): boolean {
  try {
    const dir = new FileSystem.Directory(FileSystem.Paths.document, REC_DIR);
    return new FileSystem.File(dir, `${sosId}.m4a`).exists;
  } catch {
    return false;
  }
}

export async function isMicPermissionGranted(): Promise<boolean> {
  const s = await AudioModule.getRecordingPermissionsAsync().catch(() => null);
  return s?.granted ?? false;
}

async function ensureMicPermission(): Promise<boolean> {
  const status = await AudioModule.requestRecordingPermissionsAsync().catch(
    () => null,
  );
  return status?.granted ?? false;
}

export function useSOSRecorder(args: {
  enabled: boolean;
  userId: string | null;
  sosId: string | null;
  durationMs?: number;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const stoppedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!args.enabled || !args.userId || !args.sosId) return;

    let cancelled = false;
    stoppedRef.current = false;

    (async () => {
      const granted = await ensureMicPermission();
      if (!granted || cancelled) {
        if (!granted) {
          addBreadcrumb({
            category: 'sos.recording',
            severity: 'warn',
            message: 'mic permission denied',
          });
        }
        return;
      }
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
      } catch {
        // best-effort
      }
      if (cancelled) return;
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch (err) {
        reportError(err, {
          category: 'sos.recording',
          message: 'failed to start recorder',
        });
        return;
      }
      addBreadcrumb({
        category: 'sos.recording',
        severity: 'info',
        message: `recording started for SOS ${args.sosId}`,
      });
      // Auto-stop after the configured duration. The recorder is still
      // alive after this — uploads happen on unmount via the cleanup
      // below regardless of whether we hit the timer or the user cancel.
      timerRef.current = setTimeout(
        () => {
          void recorder.stop().catch(() => undefined);
        },
        args.durationMs ?? DEFAULT_DURATION_MS,
      );
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Stop + persist on-device. Fire-and-forget; we don't block unmount.
      (async () => {
        if (stoppedRef.current) return;
        stoppedRef.current = true;
        try {
          await recorder.stop();
        } catch {
          // recorder may already be stopped
        }
        const localUri = recorder.uri ?? null;
        if (!localUri || !args.sosId) return;
        try {
          saveRecordingLocally(localUri, args.sosId);
          addBreadcrumb({
            category: 'sos.recording',
            severity: 'info',
            message: `recording saved on-device for SOS ${args.sosId}`,
          });
        } catch (err) {
          reportError(err, {
            category: 'sos.recording',
            message: 'local save failed',
            tags: { sosId: args.sosId ?? '' },
          });
        }
      })();
    };
    // We only want this effect to fire when the SOS identity changes —
    // the recorder instance is stable for the lifetime of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.enabled, args.userId, args.sosId]);
}

// Move the recorder's temp clip to a permanent on-device location.
function saveRecordingLocally(localUri: string, sosId: string): void {
  const dir = new FileSystem.Directory(FileSystem.Paths.document, REC_DIR);
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  const dest = new FileSystem.File(dir, `${sosId}.m4a`);
  if (dest.exists) dest.delete();
  new FileSystem.File(localUri).copy(dest);
}
