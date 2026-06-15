import 'dart:async';
import 'package:latlong2/latlong.dart';

import 'helpers_service.dart';
import 'location_service.dart';

/// Helper Mode runtime — while enabled, uploads the user's location every
/// [_pingMs] so nearby SOS events can find them; flips offline on disable.
/// Best-effort (a failed ping never throws). Port of RN `helper-mode.ts`.
class HelperModeService {
  HelperModeService._();

  static const _pingMs = 30000;
  static Timer? _timer;
  static LatLng? _lastPoint;

  static bool get isRunning => _timer != null;

  static Future<void> _pingOnce() async {
    try {
      final point = await LocationService.getCurrentLocation();
      if (point == null) return;
      _lastPoint = point;
      await HelpersService.setLocation(point, true);
    } catch (_) {/* offline / no perm / transient */}
  }

  static Future<void> start() async {
    await _pingOnce();
    _timer?.cancel();
    _timer = Timer.periodic(
      const Duration(milliseconds: _pingMs),
      (_) => _pingOnce(),
    );
  }

  static Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
    await HelpersService.goOffline(_lastPoint);
    _lastPoint = null;
  }
}
