import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/auth_service.dart';

/// Phase 1 Home placeholder — proves the auth gate end-to-end. The real Home
/// (map 60% + bottom sheet 40%, Protection hero, Protection Strength pill, SOS
/// button, Voice card, Helpers) is built in Phase 2.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final email =
        AuthService.currentSession?.user.email ??
            AuthService.currentSession?.user.phone ??
            'signed in';

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: AppColors.sageSoft,
                  borderRadius: BorderRadius.circular(36),
                ),
                child: const Icon(Icons.shield_outlined,
                    size: 34, color: AppColors.sageDeep),
              ),
              const SizedBox(height: 16),
              Text('Protected', style: AppTheme.bold(24)),
              const SizedBox(height: 4),
              Text(email, style: AppTheme.medium(13)),
              const SizedBox(height: 4),
              Text('Phase 1 skeleton — Home UI arrives in Phase 2',
                  style: AppTheme.medium(12, color: AppColors.textMuted)),
              const SizedBox(height: 28),
              TextButton(
                onPressed: AuthService.signOut,
                child: Text('Sign out',
                    style: AppTheme.semibold(14, color: AppColors.coralDeep)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
