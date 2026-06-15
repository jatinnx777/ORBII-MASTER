import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import '../services/voice_guard_service.dart';
import '../services/voice_phrases_service.dart';

/// Result of an arm attempt so the UI can react (prompt OEM autostart, etc.).
enum ArmResult { armed, micDenied, unavailable }

class VoiceState {
  const VoiceState({this.enabled = false, this.hours = 12, this.busy = false});
  final bool enabled;
  final int hours;
  final bool busy;

  VoiceState copyWith({bool? enabled, int? hours, bool? busy}) => VoiceState(
        enabled: enabled ?? this.enabled,
        hours: hours ?? this.hours,
        busy: busy ?? this.busy,
      );
}

/// Background Voice SOS controller — mirrors RN `handleVoiceCard` / `armBackground`.
class VoiceNotifier extends StateNotifier<VoiceState> {
  VoiceNotifier() : super(const VoiceState()) {
    _restore();
  }

  Future<void> _restore() async {
    final s = await VoiceGuardService.loadState();
    state = state.copyWith(enabled: s.enabled, hours: s.hours);
  }

  Future<bool> _ensureMic() async {
    final mic = await Permission.microphone.request();
    if (!mic.isGranted) return false;
    // Android 13+ also needs notifications for the foreground service alert.
    await Permission.notification.request();
    return true;
  }

  /// Arm background protection for [hours] (0 = until turned off).
  Future<ArmResult> arm(int hours) async {
    state = state.copyWith(busy: true);
    try {
      if (!await _ensureMic()) return ArmResult.micDenied;
      final phrases = await VoicePhrasesService.load();
      final started = await VoiceGuardService.start(phrases, hours);
      if (!started) return ArmResult.unavailable;
      await VoiceGuardService.saveState(enabled: true, hours: hours);
      state = state.copyWith(enabled: true, hours: hours);

      // Reliability: exempt from Doze if not already (the OEM autostart nudge
      // is surfaced by the UI layer).
      if (!await VoiceGuardService.isBatteryExempt()) {
        await VoiceGuardService.requestBatteryExemption();
      }
      return ArmResult.armed;
    } finally {
      state = state.copyWith(busy: false);
    }
  }

  Future<void> disarm() async {
    await VoiceGuardService.stop();
    await VoiceGuardService.saveState(enabled: false, hours: state.hours);
    state = state.copyWith(enabled: false);
  }
}

final voiceProvider =
    StateNotifierProvider<VoiceNotifier, VoiceState>((ref) => VoiceNotifier());
