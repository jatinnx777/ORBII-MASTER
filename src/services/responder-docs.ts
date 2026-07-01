import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

// Responder KYC document upload (gallery → private Supabase Storage). Mirrors
// avatars.ts but the bucket is PRIVATE (sensitive ID docs). Each doc is stored
// at responder-docs/<uid>/<kind>.jpg, and its path is recorded on
// helper_profiles so the admin can review it from the Supabase dashboard.

const BUCKET = 'responder-docs';

export type DocKind = 'aadhaar' | 'pan' | 'selfie' | 'photo';
const COLUMN: Record<DocKind, string> = {
  aadhaar: 'aadhaar_doc',
  pan: 'pan_doc',
  selfie: 'selfie_doc',
  photo: 'photo_doc',
};

/**
 * Pick an image from the gallery and upload it as the given KYC document.
 * Returns the stored path on success, null if cancelled / failed.
 */
export async function pickAndUploadDoc(
  userId: string,
  kind: DocKind,
): Promise<string | null> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return null;
    const uri = result.assets[0].uri;

    const ext = uri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
    const path = `${userId}/${kind}.${ext}`;
    const bytes = await new FileSystem.File(uri).bytes();
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      upsert: true,
    });
    if (error) {
      console.warn('[responder-docs] upload failed:', error.message);
      return null;
    }
    // Record the path on the profile so the admin can find + review it.
    await supabase
      .from('helper_profiles')
      .update({ [COLUMN[kind]]: path, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    return path;
  } catch (err) {
    console.warn('[responder-docs] upload threw:', err);
    return null;
  }
}

/** A short-lived signed URL to preview an uploaded doc (private bucket). */
export async function signedDocUrl(path: string): Promise<string | null> {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/** Mark the application as submitted for admin review. */
export async function submitForReview(userId: string): Promise<void> {
  try {
    await supabase
      .from('helper_profiles')
      .update({ verification_status: 'pending', submitted_at: new Date().toISOString() })
      .eq('user_id', userId);
  } catch {
    // best-effort
  }
}
