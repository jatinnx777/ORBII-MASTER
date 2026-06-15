import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Dart wrapper over the native `VoiceGuardPlugin` MethodChannel — the Flutter
/// equivalent of RN `src/services/background-voice.ts`. Drives the on-device
/// Vosk foreground service (start/stop) and the battery-optimisation exemption.
class VoiceGuardService {
  VoiceGuardService._();

  static const _channel = MethodChannel('com.orbii.app/voiceguard');
  static const _stateKey = 'orbii.voice.bg';

  /// Durations the user can arm protection for (0 = until turned off).
  static const durations = <(String, int)>[
    ('4 hours', 4),
    ('12 hours', 12),
    ('24 hours', 24),
    ('Until I turn it off', 0),
  ];

  static Future<bool> start(List<String> phrases, int durationHours) async {
    try {
      final durationMs = durationHours > 0 ? durationHours * 3600000 : 0;
      final ok = await _channel.invokeMethod<bool>('startGuard', {
        'phrases': phrases,
        'durationMs': durationMs,
      });
      return ok ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<void> stop() async {
    try {
      await _channel.invokeMethod('stopGuard');
    } catch (_) {/* ignore */}
  }

  /// True if ORBII is already exempt from battery optimisation (Doze).
  static Future<bool> isBatteryExempt() async {
    try {
      final v = await _channel
          .invokeMethod<bool>('isIgnoringBatteryOptimization');
      return v ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Prompt the system "let ORBII run in the background?" dialog.
  static Future<void> requestBatteryExemption() async {
    try {
      await _channel.invokeMethod('requestDisableBatteryOptimization');
    } catch (_) {/* ignore */}
  }

  // ── persisted arm state (enabled + hours) ─────────────────
  static Future<({bool enabled, int hours})> loadState() async {
    final prefs = await SharedPreferences.getInstance();
    return (
      enabled: prefs.getBool('$_stateKey.enabled') ?? false,
      hours: prefs.getInt('$_stateKey.hours') ?? 12,
    );
  }

  static Future<void> saveState({required bool enabled, required int hours}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('$_stateKey.enabled', enabled);
    await prefs.setInt('$_stateKey.hours', hours);
  }
}
