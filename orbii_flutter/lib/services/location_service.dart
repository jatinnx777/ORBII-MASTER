import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

/// Wraps geolocator to mirror RN `src/services/location.ts`: permission checks
/// plus a high-accuracy `getCurrentLocation` that converges on a real GPS fix
/// (the RN version targets BestForNavigation / ≤35 m to avoid the "3 hours
/// away" network-fix bug).
class LocationService {
  LocationService._();

  static Future<LocationPermission> currentPermission() {
    return Geolocator.checkPermission();
  }

  static Future<bool> isGranted() async {
    final p = await Geolocator.checkPermission();
    return p == LocationPermission.always ||
        p == LocationPermission.whileInUse;
  }

  /// Requests permission, returning whether it ended up granted.
  static Future<bool> requestPermission() async {
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) {
      p = await Geolocator.requestPermission();
    }
    return p == LocationPermission.always ||
        p == LocationPermission.whileInUse;
  }

  /// Best available fix. Tries a precise reading first; falls back to the last
  /// known position so the map can render immediately.
  static Future<LatLng?> getCurrentLocation() async {
    if (!await isGranted()) return null;
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.bestForNavigation,
          timeLimit: Duration(seconds: 12),
        ),
      );
      return LatLng(pos.latitude, pos.longitude);
    } catch (_) {
      final last = await Geolocator.getLastKnownPosition();
      return last == null ? null : LatLng(last.latitude, last.longitude);
    }
  }
}
