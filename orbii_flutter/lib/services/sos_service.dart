import 'dart:io';
import 'dart:math';
import 'package:latlong2/latlong.dart';

import 'auth_service.dart';
import 'community_service.dart';
import 'supabase_service.dart';

/// SOS dispatch — the spine of an emergency. Faithful port of the RN `sos.ts`
/// flow against the unchanged `sos_events` table + `sos-recordings` bucket.
///
///   dispatch → insert sos_events (active) + broadcast to nearby responders
///   resolve  → mark resolved
///   audio    → upload the 60s capture to the private bucket
class SosService {
  SosService._();

  static final _c = SupabaseService.client;

  /// Client-generated id matching the RN format `sos_<ts>_<rand>` so local
  /// and server rows stay in sync without a round-trip.
  static String newId() {
    final rand = Random().nextInt(1 << 32).toRadixString(36);
    return 'sos_${DateTime.now().millisecondsSinceEpoch}_$rand';
  }

  /// Insert the SOS row (best-effort) and broadcast it to nearby responders.
  /// Returns the sosId so the active screen can subscribe to live location.
  static Future<String> dispatch({
    required LatLng location,
    String? address,
  }) async {
    final session = AuthService.currentSession;
    final uid = session?.user.id;
    final id = newId();
    final name =
        session?.user.userMetadata?['full_name'] as String? ?? 'An ORBII user';
    final photo = session?.user.userMetadata?['avatar_url'] as String?;

    // Persist (best-effort — the live broadcast is the real-time source).
    try {
      if (uid != null) {
        await _c.from('sos_events').insert({
          'id': id,
          'user_id': uid,
          'lat': location.latitude,
          'lng': location.longitude,
          'address': address,
          'status': 'active',
          'kind': 'real',
          'user_name': name,
          'user_photo': photo,
        });
      }
    } catch (_) {/* keep going — broadcast still fires */}

    // Broadcast to every nearby responder instantly.
    await CommunityService.broadcastAlert(
      id: id,
      victim: AlertVictim(id: uid ?? id, name: name, photoUri: photo),
      location: location,
      address: address,
    );
    return id;
  }

  static Future<void> resolve(String sosId) async {
    try {
      await _c.from('sos_events').update({
        'status': 'resolved',
        'resolved_at': DateTime.now().toUtc().toIso8601String(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      }).eq('id', sosId);
    } catch (_) {/* best-effort */}
  }

  /// Upload the recorded clip to `sos-recordings/<uid>/<sosId>.m4a` and stamp
  /// `audio_path` on the row. Best-effort; failure never blocks the emergency.
  static Future<void> uploadRecording(String sosId, String filePath) async {
    final uid = AuthService.currentSession?.user.id;
    if (uid == null) return;
    try {
      final bytes = await File(filePath).readAsBytes();
      final path = '$uid/$sosId.m4a';
      await _c.storage.from('sos-recordings').uploadBinary(path, bytes);
      await _c.from('sos_events').update({'audio_path': path}).eq('id', sosId);
    } catch (_) {/* best-effort */}
  }
}
