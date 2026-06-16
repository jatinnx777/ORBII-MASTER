import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../router/app_router.dart';

/// Safe Mode — a deliberately minimal, distraction-free screen with one giant
/// SOS button. For moments when every second and every tap counts.
class SafeModeScreen extends StatelessWidget {
  const SafeModeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.textPrimary,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: AppColors.textInverse,
        title: const Text('Safe Mode'),
      ),
      body: Center(
        child: GestureDetector(
          onTap: () => context.push(Routes.sosCountdown),
          onLongPress: () =>
              context.push('${Routes.sosCountdown}?instant=true'),
          child: Container(
            width: 240,
            height: 240,
            decoration: BoxDecoration(
              color: AppColors.coral,
              shape: BoxShape.circle,
              boxShadow: const [
                BoxShadow(color: Color(0x66FF6B57), blurRadius: 40, spreadRadius: 4),
              ],
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.sos_rounded,
                    size: 72, color: AppColors.textInverse),
                const SizedBox(height: 8),
                Text('Tap for SOS',
                    style: AppTheme.semibold(15, color: AppColors.textInverse)),
                Text('Hold for instant',
                    style: AppTheme.medium(12, color: const Color(0xCCFFFFFF))),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
