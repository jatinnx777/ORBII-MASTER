import 'dart:async';
import 'package:latlong2/latlong.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_service.dart';

/// Community responder layer — emergency response ONLY. NOT a feed, chat, or
/// forum. Faithful port of the broadcast half of RN `community.ts`.
///
/// Transport: Supabase Realtime broadcast. The victim posts the alert once;
/// every subscribed listener receives it instantly (no DB table, no RLS
/// hurdle). Alerts are also backfilled from `sos_events` for responders who
/// were backgrounded when the alert fired.

const _walkingMps = 1.4;
const _alertsChannel = 'orbii:alerts';

class AlertVictim {
  const AlertVictim({
    required this.id,
    required this.name,
    this.photoUri,
    this.phone,
  });
  final String id;
  final String name;
  final String? photoUri;
  final String? phone;

  Map<String, dynamic> toJson() =>
      {'id': id, 'name': name, 'photoUri': photoUri, 'phone': phone};

  factory AlertVictim.fromJson(Map<String, dynamic> j) => AlertVictim(
        id: (j['id'] ?? '') as String,
        name: (j['name'] ?? 'Someone nearby') as String,
        photoUri: j['photoUri'] as String?,
        phone: j['phone'] as String?,
      );
}

/// A live alert as seen by a responder (distance/ETA computed per-viewer).
class CommunityAlert {
  const CommunityAlert({
    required this.id,
    required this.victim,
    required this.location,
    required this.distanceMeters,
    required this.etaSeconds,
    required this.createdAt,
  });

  final String id;
  final AlertVictim victim;
  final LatLng location;
  final double distanceMeters;
  final int etaSeconds;
  final int createdAt;
}

class CommunityService {
  CommunityService._();

  static final _c = SupabaseService.client;
  static RealtimeChannel? _broadcast;
  static bool _ready = false;

  // ── send side (victim) ───────────────────────────────────
  static RealtimeChannel _ensureBroadcast() {
    final existing = _broadcast;
    if (existing != null) return existing;
    final ch = _c.channel(
      _alertsChannel,
      opts: const RealtimeChannelConfig(ack: false, self: false),
    );
    ch.subscribe((status, _) {
      _ready = status == RealtimeSubscribeStatus.subscribed;
    });
    _broadcast = ch;
    return ch;
  }

  /// Open the channel early so the first SOS doesn't pay the handshake cost.
  static void prewarm() => _ensureBroadcast();

  static Future<void> broadcastAlert({
    required String id,
    required AlertVictim victim,
    required LatLng location,
    String? address,
  }) async {
    final ch = _ensureBroadcast();
    final payload = {
      'id': id,
      'victim': victim.toJson(),
      'location': {
        'latitude': location.latitude,
        'longitude': location.longitude,
        'address': address,
      },
      'createdAt': DateTime.now().millisecondsSinceEpoch,
    };
    // Wait briefly for SUBSCRIBED, then retry a few times.
    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (!_ready && DateTime.now().isBefore(deadline)) {
      await Future.delayed(const Duration(milliseconds: 50));
    }
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        await ch.sendBroadcastMessage(event: 'new-alert', payload: payload);
        return;
      } catch (_) {
        await Future.delayed(const Duration(milliseconds: 400));
      }
    }
  }

  // ── receive side (responder) ─────────────────────────────
  static RealtimeChannel subscribeToAlerts({
    required void Function(CommunityAlert alert) onAlert,
    LatLng? viewer,
    String? excludeUserId,
  }) {
    final ch = _c.channel(
      _alertsChannel,
      opts: const RealtimeChannelConfig(ack: false, self: false),
    );
    ch.onBroadcast(
      event: 'new-alert',
      callback: (payload) {
        final alert = _fromBroadcast(
          Map<String, dynamic>.from(payload),
          viewer,
          excludeUserId,
        );
        if (alert != null) onAlert(alert);
      },
    ).subscribe();
    return ch;
  }

  static CommunityAlert? _fromBroadcast(
    Map<String, dynamic> b,
    LatLng? viewer,
    String? excludeUserId,
  ) {
    final id = b['id'] as String?;
    final loc = b['location'];
    if (id == null || loc is! Map) return null;
    final victim = AlertVictim.fromJson(
        Map<String, dynamic>.from(b['victim'] as Map? ?? const {}));
    if (excludeUserId != null && victim.id == excludeUserId) return null;
    final point = LatLng(
      (loc['latitude'] as num).toDouble(),
      (loc['longitude'] as num).toDouble(),
    );
    final distance =
        viewer == null ? -1.0 : const Distance().as(LengthUnit.Meter, viewer, point);
    return CommunityAlert(
      id: id,
      victim: victim,
      location: point,
      distanceMeters: distance,
      etaSeconds: distance > 0 ? (distance / _walkingMps).round() : 0,
      createdAt: (b['createdAt'] ?? DateTime.now().millisecondsSinceEpoch) as int,
    );
  }

  /// Backfill from `sos_events` (active, last 15 min) within [radiusKm].
  static Future<List<CommunityAlert>> listNearbyAlerts(
    LatLng point, {
    double radiusKm = 2,
    String? excludeUserId,
  }) async {
    try {
      final since = DateTime.now()
          .toUtc()
          .subtract(const Duration(minutes: 15))
          .toIso8601String();
      final rows = await _c
          .from('sos_events')
          .select('id, user_id, lat, lng, address, created_at')
          .eq('status', 'active')
          .gte('created_at', since)
          .limit(50);
      const distance = Distance();
      final out = <CommunityAlert>[];
      for (final raw in (rows as List)) {
        final r = Map<String, dynamic>.from(raw as Map);
        if (excludeUserId != null && r['user_id'] == excludeUserId) continue;
        final loc =
            LatLng((r['lat'] as num).toDouble(), (r['lng'] as num).toDouble());
        final d = distance.as(LengthUnit.Meter, point, loc);
        if (d > radiusKm * 1000) continue;
        out.add(CommunityAlert(
          id: r['id'] as String,
          victim: AlertVictim(id: r['user_id'] as String, name: 'Someone nearby'),
          location: loc,
          distanceMeters: d,
          etaSeconds: (d / _walkingMps).round(),
          createdAt:
              DateTime.parse(r['created_at'] as String).millisecondsSinceEpoch,
        ));
      }
      out.sort((a, b) => a.distanceMeters.compareTo(b.distanceMeters));
      return out;
    } catch (_) {
      return const [];
    }
  }

  /// Record that the current user is responding (best-effort).
  static Future<void> respondToAlert({
    required String alertId,
    required String userId,
    required String name,
    String? photoUri,
  }) async {
    try {
      await _c.from('sos_responders').insert({
        'sos_id': alertId,
        'user_id': userId,
        'name': name,
        'photo_url': photoUri,
        'created_at': DateTime.now().toUtc().toIso8601String(),
      });
    } catch (_) {/* best-effort */}
  }

  static Future<void> dispose(RealtimeChannel ch) async {
    try {
      await _c.removeChannel(ch);
    } catch (_) {/* ignore */}
  }
}
