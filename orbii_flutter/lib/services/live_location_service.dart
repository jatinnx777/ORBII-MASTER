import 'package:latlong2/latlong.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_service.dart';

/// Live location pub/sub for an in-progress SOS response. Supabase Realtime
/// broadcast — no DB row per ping. Faithful port of RN `live-location.ts`.

class Responder {
  const Responder({
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

  factory Responder.fromJson(Map<String, dynamic> j) => Responder(
        id: (j['id'] ?? '') as String,
        name: (j['name'] ?? 'Helper') as String,
        photoUri: j['photoUri'] as String?,
        phone: j['phone'] as String?,
      );
}

class LiveLocationUpdate {
  const LiveLocationUpdate({
    required this.responder,
    required this.point,
    required this.at,
    this.arrived = false,
  });
  final Responder responder;
  final LatLng point;
  final int at;
  final bool arrived;
}

/// A handle the responder uses to publish their position (and "I've reached").
class LiveLocationPublisher {
  LiveLocationPublisher._(this._channel, this._responder);

  final RealtimeChannel _channel;
  final Responder _responder;
  bool _subscribed = false;

  void _send(LatLng point, bool arrived) {
    if (!_subscribed) return;
    _channel.sendBroadcastMessage(event: 'pos', payload: {
      'responder': _responder.toJson(),
      'point': {'latitude': point.latitude, 'longitude': point.longitude},
      'at': DateTime.now().millisecondsSinceEpoch,
      'arrived': arrived,
    });
  }

  void publish(LatLng point) => _send(point, false);
  void announceArrived(LatLng point) => _send(point, true);

  Future<void> dispose() async {
    try {
      await SupabaseService.client.removeChannel(_channel);
    } catch (_) {/* ignore */}
  }
}

class LiveLocationService {
  LiveLocationService._();

  static String _name(String sosId) => 'sos-live:$sosId';

  static LiveLocationPublisher publish(String sosId, Responder responder) {
    final channel = SupabaseService.client.channel(
      _name(sosId),
      opts: const RealtimeChannelConfig(ack: false, self: false),
    );
    final pub = LiveLocationPublisher._(channel, responder);
    channel.subscribe((status, _) {
      pub._subscribed = status == RealtimeSubscribeStatus.subscribed;
    });
    return pub;
  }

  static RealtimeChannel subscribe(
    String sosId,
    void Function(LiveLocationUpdate update) onUpdate,
  ) {
    final channel = SupabaseService.client.channel(
      _name(sosId),
      opts: const RealtimeChannelConfig(ack: false, self: false),
    );
    channel.onBroadcast(
      event: 'pos',
      callback: (payload) {
        final p = Map<String, dynamic>.from(payload);
        final point = p['point'];
        final resp = p['responder'];
        if (point is! Map || resp is! Map) return;
        onUpdate(LiveLocationUpdate(
          responder: Responder.fromJson(Map<String, dynamic>.from(resp)),
          point: LatLng(
            (point['latitude'] as num).toDouble(),
            (point['longitude'] as num).toDouble(),
          ),
          at: (p['at'] ?? 0) as int,
          arrived: (p['arrived'] ?? false) as bool,
        ));
      },
    ).subscribe();
    return channel;
  }
}
