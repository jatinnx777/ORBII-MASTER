import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { addBreadcrumb, reportError } from './error-reporting';

// SOS audio recorder.
//
// `expo-audio` only exposes recording via the `useAudioRecorder` hook
// (the underlying recorder is React-lifecycle scoped), so we wrap the
// hook in `useSOSRecorder` and let the ActiveSOS screen drive it: start
// recording on mount, stop on unmount, upload to Supabase Storage when
// finished.
//
// Privacy posture:
//   • Recording starts ONLY when the user has fired an SOS.
//   • The file uploads to the private `sos-recordings` bucket under the
//     path `<userId>/<sosId>.m4a`. RLS gives read access only to the
//     uploader. SQL setup in sql/11_sos_audio.sql.
//   • If the user cancels the SOS before the 60s timer, we stop early
//     and still upload whatever was captured.

const DEFAULT_DURATION_MS = 60_000;
const BUCKET = 'sos-recordings';

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
      // Stop + upload. Fire-and-forget; we don't block React unmount.
      (async () => {
        if (stoppedRef.current) return;
        stoppedRef.current = true;
        try {
          await recorder.stop();
        } catch {
          // recorder may already be stopped
        }
        const localUri = recorder.uri ?? null;
        if (!localUri || !args.userId || !args.sosId) return;
        await uploadRecording({
          localUri,
          userId: args.userId,
          sosId: args.sosId,
        }).catch((err) => {
          reportError(err, {
            category: 'sos.recording',
            message: 'upload failed',
            tags: { sosId: args.sosId ?? '' },
          });
        });
      })();
    };
    // We only want this effect to fire when the SOS identity changes —
    // the recorder instance is stable for the lifetime of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.enabled, args.userId, args.sosId]);
}

async function uploadRecording(args: {
  localUri: string;
  userId: string;
  sosId: string;
}): Promise<void> {
  const path = `${args.userId}/${args.sosId}.m4a`;
  try {
    const file = new FileSystem.File(args.localUri);
    const bytes = await file.bytes();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: 'audio/m4a',
        upsert: true,
      });
    if (error) {
      reportError(error, {
        category: 'sos.recording',
        message: 'supabase upload returned error',
        tags: { sosId: args.sosId },
      });
      return;
    }
    // Attach the audio path to the sos_events row so the responder side
    // can show a playback button. Soft-fail when the column is missing
    // (i.e. the migration in sql/11_sos_audio.sql hasn't been run yet).
    try {
      await supabase
        .from('sos_events')
        .update({ audio_path: path })
        .eq('id', args.sosId);
    } catch {
      // ignore
    }
  } catch (err) {
    reportError(err, {
      category: 'sos.recording',
      message: 'uploadRecording threw',
      tags: { sosId: args.sosId },
    });
  }
}
