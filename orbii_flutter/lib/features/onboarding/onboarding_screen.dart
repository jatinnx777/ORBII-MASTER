import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../router/app_router.dart';

/// Minimal onboarding placeholder (Phase 1). The full multi-slide intro from
/// the RN Onboarding screen lands in Phase 5. For now it routes to sign-in.
class OnboardingScreen extends StatelessWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              Text('Welcome to ORBII',
                  textAlign: TextAlign.center, style: AppTheme.bold(26)),
              const SizedBox(height: 8),
              Text(
                'Hands-free SOS, trusted circles, and help nearby — '
                'whenever you need it.',
                textAlign: TextAlign.center,
                style: AppTheme.medium(14),
              ),
              const Spacer(),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.peach,
                  foregroundColor: AppColors.textPrimary,
                ),
                onPressed: () => context.go(Routes.signIn),
                child: const Text('Get started'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
