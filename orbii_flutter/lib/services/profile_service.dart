import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart' show FileOptions;

import 'auth_service.dart';
import 'supabase_service.dart';

/// The signed-in user's profile, blended from the auth session + the `profiles`
/// table. Mirrors the read/update slice of RN `auth.ts` / `profile-sync.ts`.
class UserProfile {
  const UserProfile({
    required this.uid,
    this.email,
    this.phone,
    this.name,
    this.username,
    this.photoUrl,
  });

  final String uid;
  final String? email;
  final String? phone;
  final String? name;
  final String? username;
  final String? photoUrl;

  String get initial {
    final s = (name ?? username ?? email ?? '?').trim();
    return s.isEmpty ? '?' : s.substring(0, 1).toUpperCase();
  }
}

class ProfileService {
  ProfileService._();

  static final _c = SupabaseService.client;

  static Future<UserProfile?> load() async {
    final session = AuthService.currentSession;
    final user = session?.user;
    if (user == null) return null;
    String? name = user.userMetadata?['full_name'] as String?;
    String? photo = user.userMetadata?['avatar_url'] as String?;
    String? username;
    try {
      final row = await _c
          .from('profiles')
          .select('name, username, photo_uri, phone')
          .eq('id', user.id)
          .maybeSingle();
      if (row != null) {
        name = (row['name'] as String?) ?? name;
        username = row['username'] as String?;
        photo = (row['photo_uri'] as String?) ?? photo;
      }
    } catch (_) {/* profiles not set up / offline → use metadata */}
    return UserProfile(
      uid: user.id,
      email: user.email,
      phone: user.phone,
      name: name,
      username: username,
      photoUrl: photo,
    );
  }

  /// Update the display name on both `profiles` and the `users_public`
  /// directory so search results stay fresh. Best-effort.
  static Future<void> updateName(String name) async {
    final uid = AuthService.currentSession?.user.id;
    if (uid == null) return;
    final trimmed = name.trim();
    if (trimmed.isEmpty) return;
    final now = DateTime.now().toUtc().toIso8601String();
    try {
      await _c.from('profiles').upsert({
        'id': uid,
        'name': trimmed,
        'updated_at': now,
      });
      await _c.from('users_public').upsert({
        'id': uid,
        'name': trimmed,
        'updated_at': now,
      });
    } catch (_) {/* best-effort */}
  }

  /// Update the user's contact phone (E.164) on `profiles` + `users_public` so
  /// the invite-by-phone lookup can find them. Best-effort.
  static Future<void> updatePhone(String phoneE164) async {
    final uid = AuthService.currentSession?.user.id;
    if (uid == null) return;
    final now = DateTime.now().toUtc().toIso8601String();
    try {
      await _c.from('profiles').upsert({'id': uid, 'phone': phoneE164, 'updated_at': now});
      await _c.from('users_public').upsert({'id': uid, 'phone': phoneE164, 'updated_at': now});
    } catch (_) {/* best-effort */}
  }

  /// Upload a profile photo to the public `avatars` bucket (`<uid>/avatar.jpg`,
  /// sql/17) and mirror the public URL onto `profiles` + `users_public` so it
  /// survives re-login. Returns the new public URL. Port of RN `uploadAvatar`.
  static Future<String?> uploadAvatar(String filePath) async {
    final uid = AuthService.currentSession?.user.id;
    if (uid == null) return null;
    try {
      final bytes = await File(filePath).readAsBytes();
      final path = '$uid/avatar.jpg';
      await _c.storage.from('avatars').uploadBinary(
            path,
            bytes,
            fileOptions: const FileOptions(upsert: true, contentType: 'image/jpeg'),
          );
      // Cache-bust so the new image shows immediately.
      final url =
          '${_c.storage.from('avatars').getPublicUrl(path)}?v=${DateTime.now().millisecondsSinceEpoch}';
      final now = DateTime.now().toUtc().toIso8601String();
      await _c.from('profiles').upsert({'id': uid, 'photo_uri': url, 'updated_at': now});
      await _c.from('users_public').upsert({'id': uid, 'photo_url': url, 'updated_at': now});
      return url;
    } catch (_) {
      return null;
    }
  }
}
