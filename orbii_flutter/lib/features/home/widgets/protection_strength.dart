import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/colors.dart';
import '../../../state/protection_provider.dart';

/// Colour band + headline copy for a given score. Four colour bands, three copy
/// tiers (medium spans the two amber bands) — identical to RN `protectionBand`.
class _Band {
  const _Band(this.color, this.soft, this.label);
  final Color color;
  final Color soft;
  final String label;
}

_Band _bandFor(int pct) {
  if (pct >= 95) return const _Band(AppColors.sage, AppColors.sageSoft, 'Excellent Protection');
  if (pct >= 75) return const _Band(AppColors.peachDeep, AppColors.peachSoft, 'Almost Ready');
  if (pct >= 50) return const _Band(Color(0xFFE59A4F), Color(0xFFFBEBD9), 'Almost Ready');
  return const _Band(AppColors.coral, AppColors.coralSoft, 'Action Needed');
}

/// Slim premium status pill — Apple Battery-Health style. One compact card:
/// label + score on top, a thin progress bar + headline below. Tapping opens
/// the detail sheet. NOT a section, NOT a big card.
class ProtectionStrengthPill extends StatelessWidget {
  const ProtectionStrengthPill({
    super.key,
    required this.pct,
    required this.onTap,
  });

  final int pct;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final band = _bandFor(pct);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xB3FFFFFF)),
          boxShadow: const [
            BoxShadow(
              color: Color(0x14000000),
              blurRadius: 18,
              offset: Offset(0, 6),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    color: band.soft,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Icon(Icons.verified_user_outlined,
                      size: 13, color: band.color),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Text('Protection Strength',
                      style: AppTheme.semibold(13.5)),
                ),
                Text('$pct%', style: AppTheme.bold(14, color: band.color)),
                const SizedBox(width: 2),
                const Icon(Icons.chevron_right,
                    size: 15, color: AppColors.textMuted),
              ],
            ),
            const SizedBox(height: 9),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: (pct / 100).clamp(0.04, 1.0),
                minHeight: 5,
                backgroundColor: AppColors.creamDeep,
                valueColor: AlwaysStoppedAnimation(band.color),
              ),
            ),
            const SizedBox(height: 5),
            Text(band.label, style: AppTheme.medium(11, color: band.color)),
          ],
        ),
      ),
    );
  }
}

/// Bottom sheet behind the score — checklist (✓ / ⚠) + a "Fix Now" button that
/// targets the highest-weighted unmet factor.
class ProtectionSheet extends StatelessWidget {
  const ProtectionSheet({
    super.key,
    required this.pct,
    required this.factors,
    required this.onFix,
  });

  final int pct;
  final List<ProtectionFactor> factors;
  final void Function(String key) onFix;

  static Future<void> show(
    BuildContext context, {
    required int pct,
    required List<ProtectionFactor> factors,
    required void Function(String key) onFix,
  }) {
    return showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) =>
          ProtectionSheet(pct: pct, factors: factors, onFix: onFix),
    );
  }

  @override
  Widget build(BuildContext context) {
    final band = _bandFor(pct);
    final unmet = factors.where((f) => !f.ok).toList()
      ..sort((a, b) => b.weight.compareTo(a.weight));
    final nextFix = unmet.isEmpty ? null : unmet.first;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.cream,
        borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
      ),
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 5,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: AppColors.creamDeep,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Protection Strength', style: AppTheme.bold(20)),
                  Text(band.label,
                      style: AppTheme.medium(13, color: band.color)),
                ],
              ),
              Text('$pct%', style: AppTheme.bold(30, color: band.color)),
            ],
          ),
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: (pct / 100).clamp(0.04, 1.0),
              minHeight: 7,
              backgroundColor: AppColors.creamDeep,
              valueColor: AlwaysStoppedAnimation(band.color),
            ),
          ),
          const SizedBox(height: 16),
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(20),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              children: [
                for (final f in factors)
                  GestureDetector(
                    onTap: f.ok ? null : () => onFix(f.key),
                    behavior: HitTestBehavior.opaque,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 13),
                      child: Row(
                        children: [
                          Container(
                            width: 26,
                            height: 26,
                            decoration: BoxDecoration(
                              color: f.ok
                                  ? AppColors.sageSoft
                                  : AppColors.coralSoft,
                              borderRadius: BorderRadius.circular(13),
                            ),
                            child: Icon(
                              f.ok ? Icons.check : Icons.warning_amber_rounded,
                              size: 14,
                              color: f.ok
                                  ? AppColors.sageDeep
                                  : AppColors.coralDeep,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(f.label, style: AppTheme.medium(14.5, color: AppColors.textPrimary)),
                          ),
                          Text(
                            f.ok ? '+${f.weight}%' : 'Fix',
                            style: AppTheme.semibold(12.5,
                                color: f.ok
                                    ? AppColors.sageDeep
                                    : AppColors.coralDeep),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          if (nextFix != null)
            FilledButton.icon(
              onPressed: () => onFix(nextFix.key),
              icon: const Icon(Icons.flash_on, size: 16),
              label: Text('Fix Now — ${nextFix.label}'),
            )
          else
            Container(
              padding: const EdgeInsets.symmetric(vertical: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.sageSoft,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.verified_user,
                      size: 16, color: AppColors.sageDeep),
                  const SizedBox(width: 8),
                  Text("You're fully protected",
                      style: AppTheme.semibold(15, color: AppColors.sageDeep)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
