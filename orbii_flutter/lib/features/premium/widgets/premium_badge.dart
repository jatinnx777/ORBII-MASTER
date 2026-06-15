import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/colors.dart';
import '../../../state/subscription_provider.dart';

/// Small "ORBII Plus" pill shown once the user is premium. Reacts to the
/// subscription provider, so it appears instantly after a successful purchase.
class PremiumBadge extends ConsumerWidget {
  const PremiumBadge({super.key, this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isPlus = ref.watch(isPremiumProvider);
    if (!isPlus) return const SizedBox.shrink();
    return Container(
      padding: EdgeInsets.symmetric(
          horizontal: compact ? 8 : 10, vertical: compact ? 3 : 5),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.peach, AppColors.peachDeep],
        ),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.workspace_premium,
              size: compact ? 12 : 14, color: AppColors.textPrimary),
          const SizedBox(width: 4),
          Text('ORBII Plus',
              style: AppTheme.semibold(compact ? 10 : 11.5,
                  color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}
