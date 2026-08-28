import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraView } from 'expo-camera';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { addBreadcrumb, reportError } from './error-reporting';

// SOS video capture.
//
// Starts when a real SOS goes active. The footage is saved to HER OWN GALLERY
// and is never uploaded. That is a deliberate split from the audio clip, which
// does go to Supabase: a camera pointed at an assault records things that must
// not sit on our infrastructure, and footage only she holds is footage nobody at
// ORBII can be compelled to produce, leak, or moderate. There is no share
// action, for the same reason: the moment we build a distribution path we own
// the problem we were avoiding.
//
// WHY IT IS RECORDED IN CHUNKS.
// An MP4 writes its index at the END of the file. One long recording that is
// interrupted, by a crash, a dead battery, or the phone being taken, is usually
// not playable at all. Sixty second segments mean everything up to the moment of
// interruption survives and plays, and each is written to the gallery as it
// completes rather than at the end. On a safety app the recording most likely to
// matter is precisely the one that got interrupted.
//
// WHY THE VIDEO IS MUTED.
// The SOS audio recorder is already holding the microphone. Two recorders on one
// mic is a fight Android does not arbitrate gracefully: one of them fails, and
// which one is not predictable. The audio clip is the one that reaches
// responders, so video gives the mic up rather than risk it. The sound of the
// incident is still captured, by the other recorder.
//
// WHAT THIS CANNOT DO.
// Android does not let a backgrounded app hold the camera. Video records while
// the SOS screen is in front, which the overlay permission puts it there for,
// and the screen is kept awake for the duration. If she locks the phone or
// switches apps, the OS stops the camera and we stop with it.
// Do not describe this as recording "until the SOS ends" anywhere user-facing.
const CHUNK_SECONDS = 60;
const ALBUM = 'ORBII';
const KEEP_AWAKE_TAG = 'sos-video';

// Refuse to start another segment below this. A safety app that fills the phone
// and takes maps and the dialler down with it has done more harm than good.
const MIN_FREE_BYTES = 300 * 1024 * 1024;

export async function isCameraPermissionGranted(): Promise<boolean> {
  const s = await Camera.getCameraPermissionsAsync().catch(() => null);
  return s?.granted ?? false;
}

/** Both halves must be granted, or a recording has nowhere to land. */
export async function isVideoEvidenceReady(): Promise<boolean> {
  const cam = await Camera.getCameraPermissionsAsync().catch(() => null);
  if (!cam?.granted) return false;
  const lib = await MediaLibrary.getPermissionsAsync(true).catch(() => null);
  return lib?.granted ?? false;
}

/**
 * Ask for camera and gallery access.
 *
 * Call this from SETTINGS, never from a live SOS. A permission dialog in front
 * of a woman who has just triggered an alarm is the worst possible moment to ask
 * her anything, and a tap in the wrong place would then also cost her the
 * recording she was trying to make.
 */
export async function requestVideoEvidencePermissions(): Promise<boolean> {
  try {
    const cam = await Camera.requestCameraPermissionsAsync();
    if (!cam.granted) return false;
    // Write scope only. ORBII never reads her existing photos.
    const lib = await MediaLibrary.requestPermissionsAsync(true);
    return lib.granted;
  } catch (err) {
    reportError(err, {
      category: 'sos.video',
      message: 'could not request camera or gallery access',
    });
    return false;
  }
}

function hasRoomForAnotherChunk(): boolean {
  try {
    return Paths.availableDiskSpace > MIN_FREE_BYTES;
  } catch {
    // Unknown free space is treated as "go ahead". A storage check that fails
    // must not be the reason there is no evidence.
    return true;
  }
}

async function saveToGallery(uri: string): Promise<void> {
  const asset = await MediaLibrary.createAssetAsync(uri);
  try {
    const album = await MediaLibrary.getAlbumAsync(ALBUM);
    if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    else await MediaLibrary.createAlbumAsync(ALBUM, asset, false);
  } catch {
    // The clip is already in her gallery by this point. Failing to file it into
    // an album is cosmetic and must never lose the recording.
  }
}

export function useSOSVideoRecorder(args: { enabled: boolean; sosId: string | null }) {
  const { enabled, sosId } = args;

  const cameraRef = useRef<CameraView | null>(null);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  // Guards against a second loop if onCameraReady fires more than once, which
  // it does on some devices after a lifecycle blip.
  const loopStartedRef = useRef(false);

  const [armed, setArmed] = useState(false);
  const [segments, setSegments] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Permission is CHECKED here, never requested. If she has not granted it in
  // settings, the SOS proceeds silently without video. Nothing is shown to her:
  // she is in the middle of an emergency and could not act on it now anyway.
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !sosId) {
      setArmed(false);
      return;
    }
    (async () => {
      const ok = await isVideoEvidenceReady();
      if (cancelled || !mountedRef.current) return;
      if (!ok) {
        addBreadcrumb({
          category: 'sos.video',
          message: 'camera or gallery not granted, continuing without video',
          severity: 'info',
        });
        return;
      }
      setArmed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, sosId]);

  const runLoop = useCallback(async () => {
    while (runningRef.current) {
      const cam = cameraRef.current;
      if (!cam) break;

      if (!hasRoomForAnotherChunk()) {
        addBreadcrumb({
          category: 'sos.video',
          message: 'storage too low for another segment',
          severity: 'warn',
        });
        break;
      }

      let uri: string | null = null;
      try {
        // Muting is a prop on the CameraView, not an option here. The screen
        // passes mute so the SOS audio recorder keeps the microphone.
        const res = await cam.recordAsync({ maxDuration: CHUNK_SECONDS });
        uri = res?.uri ?? null;
      } catch {
        // The camera being taken away lands here: screen locked, app
        // backgrounded, another app grabbed it. Stop quietly. The SOS is
        // unaffected and every completed segment is already in her gallery.
        addBreadcrumb({
          category: 'sos.video',
          message: 'camera released, completed segments are saved',
          severity: 'info',
        });
        break;
      }

      if (!uri) break;

      try {
        await saveToGallery(uri);
        if (mountedRef.current) setSegments((n) => n + 1);
      } catch (err) {
        reportError(err, {
          category: 'sos.video',
          message: 'could not save a segment to the gallery',
        });
      }
    }
    runningRef.current = false;
  }, []);

  /**
   * Handed to the CameraView. The loop MUST NOT start before this fires. A
   * recordAsync against a camera that has not finished mounting either throws or
   * returns nothing, and the first version of this file started the loop
   * immediately, found a null ref, and exited without ever recording a frame.
   */
  const onCameraReady = useCallback(() => {
    if (loopStartedRef.current) return;
    loopStartedRef.current = true;
    runningRef.current = true;
    // The camera dies with the screen, so the screen must not sleep.
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    addBreadcrumb({ category: 'sos.video', message: 'recording started', severity: 'info' });
    void runLoop();
  }, [runLoop]);

  // Teardown. Stops the segment in flight, which resolves recordAsync with
  // whatever it captured so the loop can still write it out.
  useEffect(
    () => () => {
      runningRef.current = false;
      loopStartedRef.current = false;
      try {
        cameraRef.current?.stopRecording();
      } catch {
        // already stopped
      }
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    },
    [],
  );

  // `armed` drives whether the screen mounts a CameraView at all. Mounting it
  // only once permission is confirmed keeps the camera closed for everyone who
  // has not opted in, which matters for a permission this sensitive.
  return { cameraRef, onCameraReady, armed, segments };
}
