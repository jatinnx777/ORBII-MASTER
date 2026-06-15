import 'package:latlong2/latlong.dart';

import 'supabase_service.dart';

/// Nearby-helper search backed by PostGIS (sql/12_helpers.sql). Faithful port
/// of RN `helpers.ts` — uses the `set_helper_location` and `nearest_helpers`
/// RPCs unchanged. No paid geo APIs.

class NearestHelper {
  const NearestHelper({
    required this.userId,
    required this.name,
    required this.distanceMeters,
    required this.location,
    this.photoUrl,
    this.rating = 5,
  });

  final String userId;
  final String name;
  final double distanceMeters;
  final LatLng location;
  final String? photoUrl;
  final double rating;
}

class HelpersService {
  HelpersService._();

  static final _c = SupabaseService.client;

  /// Upsert the current user's helper location + online state.
  static Future<void> setLocation(LatLng point, bool online) async {
    await _c.rpc('set_helper_location', params: {
      'p_lat': point.latitude,
      'p_lng': point.longitude,
      'p_online': online,
    });
  }

  /// Best-effort: mark offline.
  static Future<void> goOffline(LatLng? point) async {
    if (point == null) return;
    try {
      await setLocation(point, false);
    } catch (_) {/* ignore */}
  }

  /// Online, fresh helpers within [radiusKm], nearest first.
  static Future<List<NearestHelper>> findNearest(
    LatLng point, {
    double radiusKm = 5,
    int limit = 10,
  }) async {
    try {
      final data = await _c.rpc('nearest_helpers', params: {
        'lat': point.latitude,
        'lng': point.longitude,
        'radius_km': radiusKm,
        'limit_count': limit,
      });
      final list = (data as List?) ?? const [];
      return list.map((raw) {
        final r = Map<String, dynamic>.from(raw as Map);
        return NearestHelper(
          userId: r['user_id'] as String,
          name: (r['name'] ?? 'Helper') as String,
          photoUrl: r['photo_url'] as String?,
          rating: double.tryParse('${r['rating'] ?? 5}') ?? 5,
          distanceMeters: double.tryParse('${r['distance_m'] ?? 0}') ?? 0,
          location: LatLng(
            (r['lat_h'] as num).toDouble(),
            (r['lng_h'] as num).toDouble(),
          ),
        );
      }).toList();
    } catch (_) {
      return const [];
    }
  }

  static Future<int> countNearby(LatLng point, {double radiusKm = 5}) async {
    final helpers = await findNearest(point, radiusKm: radiusKm, limit: 50);
    return helpers.length;
  }
}
