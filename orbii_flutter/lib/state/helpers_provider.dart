import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/helper_mode_service.dart';

/// Helper-availability toggle. When on, the device pings its location to the
/// PostGIS `helpers_live` table so nearby SOS events can find it. Mirrors RN
/// `helper-mode.ts`.
class HelperModeController extends StateNotifier<bool> {
  HelperModeController() : super(HelperModeService.isRunning);

  Future<void> setEnabled(bool value) async {
    if (value) {
      await HelperModeService.start();
    } else {
      await HelperModeService.stop();
    }
    state = value;
  }

  Future<void> toggle() => setEnabled(!state);
}

final helperModeProvider =
    StateNotifierProvider<HelperModeController, bool>(
  (ref) => HelperModeController(),
);
