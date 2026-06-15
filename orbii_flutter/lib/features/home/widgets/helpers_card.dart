import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/colors.dart';

/// Helpers-nearby row. Phase 2 shows the count + empty-state CTA; live presence
/// avatars (Realtime) are wired in Phase 4. Mirrors RN `HelpersCard`.
class HelpersCard extends StatelessWidget {
  const HelpersCard({super.key, required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xB3FFFFFF)),
          boxShadow: const [
            BoxShadow(
                color: Color(0x14000000),
                blurRadius: 18,
                offset: Offset(0, 6)),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.lavenderSoft,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(Icons.group_outlined,
                  size: 18, color: AppColors.lavenderDeep),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    count > 0
                        ? '$count Helper${count == 1 ? '' : 's'} nearby'
                        : 'Build your circle',
                    style: AppTheme.semibold(15.5),
                  ),
                  Text(
                    count > 0
                        ? 'Available now, tap to view'
                        : 'Invite people you trust',
                    style: AppTheme.medium(12.5),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right,
                size: 18, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}
