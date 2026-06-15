import 'dart:async';
import 'package:latlong2/latlong.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_service.dart';

/// A peer currently sharing presence (helpers/circle members on the map).
/// Mirrors RN `PresencePeer`.
class PresencePeer {
  const PresencePeer({
    required this.userId,
    required this.name,
    this.photoUri,
    this.location,
    this.isVerified = false,
    this.at = 0,
  });

  final String userId;
  final String name;
  final String? photoUri;
  final LatLng? location;
  final bool isVerified;
  final int at;

  factory PresencePeer.fromPayload(Map<String, dynamic> p) {
    final loc = p['location'];
    LatLng? point;
    if (loc is Map && loc['latitude'] != null && loc['longitude'] != null) {
      point = LatLng(
        (loc['latitude'] as num).toDouble(),
        (loc['longitude'] as num).toDouble(),
      );
    }
    return PresencePeer(
      userId: (p['userId'] ?? '') as String,
      name: (p['name'] ?? 'Someone') as String,
      photoUri: p['photoUri'] as String?,
      location: point,
      isVerified: (p['isVerified'] ?? false) as bool,
      at: (p['at'] ?? 0) as int,
    );
  }
}

/// Realtime presence — every open app joins one channel and tracks its own
/// row. Used to render helpers/peers on the map and count "nearby" without a
/// DB table. Faithful port of the presence half of RN `community.ts`.
class PresenceService {
  PresenceService._();

  static const _channelName = 'orbii:presence';

  static final _c = SupabaseService.client;
  static RealtimeChannel? _channel;
  static final _controller =
      StreamController<List<PresencePeer>>.broadcast();
  static List<PresencePeer> _last = const [];

  static Stream<List<PresencePeer>> get stream => _controller.stream;
  static List<PresencePeer> get current => _last;

  static Map<String, dynamic> _payload({
    required String userId,
    required String name,
    String? photoUri,
    LatLng? location,
    bool isVerified = false,
  }) =>
      {
        'userId': userId,
        'name': name,
        'photoUri': photoUri,
        'location': location == null
            ? null
            : {'latitude': location.latitude, 'longitude': location.longitude},
        'isVerified': isVerified,
        'at': DateTime.now().millisecondsSinceEpoch,
      };

  /// Join the presence channel and start announcing position.
  static Future<void> join({
    required String userId,
    required String name,
    String? photoUri,
    LatLng? location,
    bool isVerified = false,
  }) async {
    if (_channel != null) {
      await _channel!.track(_payload(
        userId: userId,
        name: name,
        photoUri: photoUri,
        location: location,
        isVerified: isVerified,
      ));
      return;
    }
    final channel = _c.channel(
      _channelName,
      opts: RealtimeChannelConfig(key: userId),
    );
    channel.onPresenceSync((_) {
      final peers = <PresencePeer>[];
      for (final state in channel.presenceState()) {
        if (state.presences.isEmpty) continue;
        final last = state.presences.last;
        peers.add(PresencePeer.fromPayload(
          Map<String, dynamic>.from(last.payload),
        ));
      }
      _last = peers;
      _controller.add(peers);
    });
    channel.subscribe((status, error) async {
      if (status == RealtimeSubscribeStatus.subscribed) {
        await channel.track(_payload(
          userId: userId,
          name: name,
          photoUri: photoUri,
          location: location,
          isVerified: isVerified,
        ));
      }
    });
    _channel = channel;
  }

  static Future<void> update({
    required String userId,
    required String name,
    String? photoUri,
    required LatLng location,
    bool isVerified = false,
  }) async {
    final ch = _channel;
    if (ch == null) return;
    await ch.track(_payload(
      userId: userId,
      name: name,
      photoUri: photoUri,
      location: location,
      isVerified: isVerified,
    ));
  }

  static Future<void> leave() async {
    final ch = _channel;
    if (ch == null) return;
    try {
      await ch.untrack();
      await _c.removeChannel(ch);
    } catch (_) {/* ignore */}
    _channel = null;
    _last = const [];
  }

  /// Peers within [radiusKm] of [point], excluding [excludeUserId].
  static int countNearby(LatLng? point, String? excludeUserId,
      {double radiusKm = 5}) {
    if (point == null) {
      return (_last.length - 1).clamp(0, _last.length);
    }
    const distance = Distance();
    return _last.where((p) {
      if (excludeUserId != null && p.userId == excludeUserId) return false;
      final loc = p.location;
      if (loc == null) return false;
      return distance.as(LengthUnit.Meter, point, loc) <= radiusKm * 1000;
    }).length;
  }
}
