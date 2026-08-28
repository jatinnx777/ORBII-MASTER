import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraView } from 'expo-camera';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { addBreadcrumb, reportError } from './error-reporting';

// SOS video capture.
//
// Starts when a real SOS goes active and keeps going until the SOS ends. The
// footage is saved to HER OWN GALLERY and is never uploaded. That is a
// deliberate split from the audio clip, which does go to Supabase: a camera
// pointed at an assault records things that must not sit on our infrastructure,
// and evidence she alone holds is evidence nobody at ORBII can be compelled to
// produce, leak, or moderate.
//
// WHY IT IS RECORDED IN CHUNKS.
// An MP4 writes its index at the END of the file. One long recording that is
// interrupted, by a crash, a dead battery, or the phone being taken, is usually
// not playable at all. Sixty second segments mean everything up to the moment of
// interruption survives and plays. On a safety app the recording most likely to
// matter is precisely the one that got interrupted, so this is not a detail.
//
// Each segment is written to the gallery as it completes rather than at the end,
// for the same reason.
//
// WHAT THIS CANNOT DO.
// Android does not let a backgrounded app hold the camera. Video records while
// the SOS screen is in front, which the overlay permission puts it there for,
// and the screen is kept awake for the duration. If she locks the phone or
// switches apps, the OS stops the camera and we stop with it. Audio has no such
// restriction, which is why the audio clip is the one that keeps running.
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

/**
 * Ask for camera and gallery access.
 *
 * Call this from SETTINGS, never from a live SOS. A permission dialog in front
 * of a woman who has just triggered an alarm is the worst possible moment to
 * ask her anything, and a denied prompt would then also cost her the recording.
 */
export async function requestVideoEvidencePermissions(): Promise<boolean> {
  try {
    const cam = await Camera.requestCameraPermissionsAsync();
    if (!cam.granted) return false;
    // Only asks for the write scope. ORBII never reads her existing photos.
    const lib = await MediaLibrary.requestPermissionsAsync(true);
    return lib.granted;
  } catch (err) {
    reportError(err, { category: 'sos.video', message: 'could not request camera or gallery access' });
    return false;
  }
}

async function hasRoomForAnotherChunk(): Promise<boolean> {
  try {
    const free = await FileSystem.getFreeDiskStorageAsync();
    return free > MIN_FREE_BYTES;
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
    // The asset is already in her gallery at this point. Failing to file it in
    // an album is cosmetic and must never lose the clip.
  }
}

export function useSOSVideoRecorder(args: { enabled: boolean; sosId: string | null }) {
  const { enabled, sosId } = args;
  const cameraRef = useRef<CameraView | null>(null);
  const runningRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [segments, setSegments] = useState(0);

  const loop = useCallback(async () => {
    while (runningRef.current) {
      const cam = cameraRef.current;
      if (!cam) return;

      if (!(await hasRoomForAnotherChunk())) {
        addBreadcrumb({ category: 'sos.video', message: 'storage too low for another segment', severity: 'warn' });
        return;
      }

      let uri: string | null = null;
      try {
        const res = await cam.recordAsync({ maxDuration: CHUNK_SECONDS });
        uri = res?.uri ?? null;
      } catch (err) {
        // The camera being taken away (screen locked, app backgrounded, another
        // app grabbed it) lands here. Stop quietly: the SOS itself is unaffected
        // and every completed segment is already in her gallery.
        addBreadcrumb({ category: 'sos.video', message: 'camera released, segments so far are saved', severity: 'info' });
        runningRef.current = false;
        break;
      }

      if (!uri) break;

      try {
        await saveToGallery(uri);
        setSegments((n) => n + 1);
      } catch (err) {
        reportError(err, { category: 'sos.video', message: 'could not save a segment to the gallery' });
      }
    }
  }, [sosId]);

  useEffect(() => {
    if (!enabled || !sosId) return;

    let cancelled = false;
    (async () => {
      // Permission is checked, never requested. If she has not granted it, the
      // SOS proceeds silently without video rather than stopping to ask.
      if (!(await isCameraPermissionGranted())) {
        addBreadcrumb({ category: 'sos.video', message: 'camera not granted, continuing without video', severity: 'info' });
        return;
      }
      if (cancelled) return;

      runningRef.current = true;
      setRecording(true);
      // The camera dies with the screen, so the screen must not sleep.
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
      addBreadcrumb({ category: 'sos.video', message: 'recording started', severity: 'info' });
      await loop();
      setRecording(false);
    })();

    return () => {
      cancelled = true;
      runningRef.current = false;
      // Ends the segment in flight; recordAsync resolves with what it captured,
      // and the loop writes it out before exiting.
      try {
        cameraRef.current?.stopRecording();
      } catch {
        // already stopped
      }
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      setRecording(false);
    };
  }, [enabled, sosId, loop]);

  return { cameraRef, recording, segments };
}
