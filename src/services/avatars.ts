import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';
import { reportError } from './error-reporting';

// Profile photo upload. ImagePicker gives a LOCAL file uri (file://…) which
// is meaningless after sign-out / on another device, so we upload it to the
// public `avatars` bucket (sql/17_avatars.sql) and store the resulting public
// URL on the profile. That's what makes the photo survive a re-login.

const BUCKET = 'avatars';

/**
 * Uploads a local image to the avatars bucket, returns its public URL.
 * Passes through unchanged if it's already a remote URL; falls back to the
 * original uri if the upload fails (so editing never hard-breaks).
 */
export async function uploadAvatar(
  userId: string,
  localUri: string | null,
): Promise<string | null> {
  if (!localUri) return null;
  if (/^https?:\/\//i.test(localUri)) return localUri; // already uploaded
  try {
    const ext = localUri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
    const path = `${userId}/avatar.${ext}`;
    const file = new FileSystem.File(localUri);
    const bytes = await file.bytes();
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      upsert: true,
    });
    if (error) {
      // Falling back to localUri means a file:// path gets stored, and that
      // path dies. EditProfile warns the user; this makes sure WE see it too.
      reportError(error, {
        category: 'avatar.upload',
        message: 'avatar upload failed — photo will not survive sign-out',
        tags: { userId },
      });
      return localUri;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    // cache-bust so the new photo shows immediately instead of a stale CDN copy
    return `${data.publicUrl}?v=${Date.now()}`;
  } catch (err) {
    console.warn('[avatars] upload threw:', err);
    return localUri;
  }
}
