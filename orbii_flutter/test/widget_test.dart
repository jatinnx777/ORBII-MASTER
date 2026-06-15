// Smoke test for the ORBII theme. Supabase init requires platform channels,
// so full app boot is covered by integration tests later; here we just verify
// the design system constructs without throwing.
import 'package:flutter_test/flutter_test.dart';
import 'package:orbii/core/theme/app_theme.dart';

void main() {
  test('light theme builds', () {
    final theme = AppTheme.light;
    expect(theme.useMaterial3, isTrue);
  });
}
