import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import 'location_provider.dart';

/// One weighted factor that contributes to the Protection Strength score.
/// Mirrors the RN `protectionFactors` array in HomeScreen.tsx exactly.
class ProtectionFactor {
  const ProtectionFactor({
    required this.key,
    required this.label,
    required this.weight,
    required this.ok,
  });

  final String key;
  final String label;
  final int weight;
  final bool ok;
}

class ProtectionState {
  const ProtectionState({this.factors = const []});
  final List<ProtectionFactor> factors;

  /// Weighted 0–100 score (same weights as RN).
  int get pct =>
      factors.where((f) => f.ok).fold(0, (sum, f) => sum + f.weight);
}

/// Device-level signals feeding the score. Voice/background/contacts arrive in
/// later phases; for now they read as false until their services exist, which
/// is honest (the user hasn't set them up yet on Flutter).
class ProtectionNotifier extends StateNotifier<ProtectionState> {
  ProtectionNotifier(this._ref) : super(const ProtectionState()) {
    refresh();
  }

  final Ref _ref;

  // Placeholders flipped on by Phase 3 (voice) / Phase 4 (contacts).
  bool _voiceOn = false;
  bool _backgroundOn = false;
  bool _hasContacts = false;

  void setVoice({bool? voiceOn, bool? backgroundOn}) {
    _voiceOn = voiceOn ?? _voiceOn;
    _backgroundOn = backgroundOn ?? _backgroundOn;
    refresh();
  }

  void setHasContacts(bool value) {
    _hasContacts = value;
    refresh();
  }

  Future<void> refresh() async {
    final notif = await Permission.notification.isGranted;
    final mic = await Permission.microphone.isGranted;
    final battery = await Permission.ignoreBatteryOptimizations.isGranted;
    final locationOk = _ref.read(locationProvider).granted;

    state = ProtectionState(factors: [
      ProtectionFactor(key: 'voice', label: 'Voice SOS', weight: 20, ok: _voiceOn),
      ProtectionFactor(key: 'background', label: 'Background protection', weight: 20, ok: _backgroundOn),
      ProtectionFactor(key: 'battery', label: 'Battery optimization off', weight: 15, ok: battery),
      ProtectionFactor(key: 'notifications', label: 'Notifications enabled', weight: 15, ok: notif),
      ProtectionFactor(key: 'microphone', label: 'Microphone access', weight: 10, ok: mic),
      ProtectionFactor(key: 'location', label: 'Location access', weight: 10, ok: locationOk),
      ProtectionFactor(key: 'contacts', label: 'Emergency contacts', weight: 5, ok: _hasContacts),
      ProtectionFactor(key: 'autostart', label: 'Autostart allowed', weight: 5, ok: battery),
    ]);
  }
}

final protectionProvider =
    StateNotifierProvider<ProtectionNotifier, ProtectionState>(
  (ref) => ProtectionNotifier(ref),
);
