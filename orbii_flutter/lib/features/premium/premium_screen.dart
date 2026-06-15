import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/payment_service.dart';
import '../../state/subscription_provider.dart';

/// ORBII Plus upgrade screen — hero, plan comparison, and the Razorpay upgrade
/// flow with loading / error / retry and a post-purchase celebration.
class PremiumScreen extends ConsumerStatefulWidget {
  const PremiumScreen({super.key});

  @override
  ConsumerState<PremiumScreen> createState() => _PremiumScreenState();
}

class _PremiumScreenState extends ConsumerState<PremiumScreen> {
  final _payments = PaymentService();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _payments.dispose();
    super.dispose();
  }

  Future<void> _upgrade() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await _payments.purchasePlus();
    if (!mounted) return;
    setState(() => _busy = false);

    switch (result.status) {
      case PaymentStatus.success:
        await ref.read(subscriptionProvider.notifier).refresh();
        if (mounted) _showCelebration();
      case PaymentStatus.cancelled:
        setState(() => _error = 'Checkout cancelled. You can try again anytime.');
      case PaymentStatus.failed:
        setState(() => _error = result.message ?? 'Payment failed. Please retry.');
    }
  }

  void _showCelebration() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => _CelebrationDialog(
        onDone: () {
          Navigator.of(context).pop(); // dialog
          Navigator.of(context).maybePop(); // back to Home
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isPlus = ref.watch(isPremiumProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('ORBII Plus')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _Hero(isPlus: isPlus),
          const SizedBox(height: 24),
          _ComparisonCard(),
          const SizedBox(height: 20),

          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_error!,
                  textAlign: TextAlign.center,
                  style: AppTheme.medium(13, color: AppColors.coralDeep)),
            ),

          if (isPlus)
            Container(
              padding: const EdgeInsets.all(16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.sageSoft,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.verified, color: AppColors.sageDeep),
                  const SizedBox(width: 8),
                  Text("You're on ORBII Plus",
                      style: AppTheme.semibold(15, color: AppColors.sageDeep)),
                ],
              ),
            )
          else
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.coral,
                minimumSize: const Size.fromHeight(54),
              ),
              onPressed: _busy ? null : _upgrade,
              child: _busy
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: AppColors.textInverse),
                    )
                  : const Text('Upgrade to ORBII Plus'),
            ),

          const SizedBox(height: 12),
          Text('Test mode — use any Razorpay test card.',
              textAlign: TextAlign.center,
              style: AppTheme.medium(11, color: AppColors.textMuted)),
        ],
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero({required this.isPlus});
  final bool isPlus;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFE9B8), AppColors.peach],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
      ),
      child: Column(
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Icon(Icons.workspace_premium,
                size: 38, color: AppColors.peachDeep),
          ),
          const SizedBox(height: 16),
          Text('ORBII Plus', style: AppTheme.bold(26)),
          const SizedBox(height: 4),
          Text(
            isPlus
                ? 'Thank you for protecting yourself with Plus.'
                : 'Enhanced protection, priority features, and everything we add next.',
            textAlign: TextAlign.center,
            style: AppTheme.medium(13, color: AppColors.textPrimary),
          ),
        ],
      ),
    );
  }
}

class _ComparisonCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xB3FFFFFF)),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('ORBII', style: AppTheme.semibold(15)),
          const SizedBox(height: 6),
          _row('Basic protection', true),
          const Divider(height: 28),
          Row(
            children: [
              Text('ORBII Plus', style: AppTheme.semibold(15)),
              const SizedBox(width: 8),
              const Icon(Icons.workspace_premium,
                  size: 16, color: AppColors.peachDeep),
            ],
          ),
          const SizedBox(height: 6),
          _row('Enhanced protection', true),
          _row('Advanced Voice SOS options', true),
          _row('Priority features', true),
          _row('Future premium benefits', true),
        ],
      ),
    );
  }

  Widget _row(String label, bool on) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Icon(on ? Icons.check_circle : Icons.remove_circle_outline,
              size: 18, color: on ? AppColors.sage : AppColors.textMuted),
          const SizedBox(width: 10),
          Text(label, style: AppTheme.medium(14, color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}

class _CelebrationDialog extends StatelessWidget {
  const _CelebrationDialog({required this.onDone});
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppColors.cream,
      shape:
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0.7, end: 1),
              duration: const Duration(milliseconds: 500),
              curve: Curves.elasticOut,
              builder: (_, scale, child) =>
                  Transform.scale(scale: scale, child: child),
              child: Container(
                width: 84,
                height: 84,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                      colors: [AppColors.peach, AppColors.peachDeep]),
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Icon(Icons.celebration,
                    size: 44, color: AppColors.textInverse),
              ),
            ),
            const SizedBox(height: 20),
            Text('Welcome to ORBII Plus!', style: AppTheme.bold(20)),
            const SizedBox(height: 6),
            Text(
              'Enhanced protection is now active. Stay safe out there.',
              textAlign: TextAlign.center,
              style: AppTheme.medium(13),
            ),
            const SizedBox(height: 24),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.peach,
                foregroundColor: AppColors.textPrimary,
                minimumSize: const Size.fromHeight(48),
              ),
              onPressed: onDone,
              child: const Text('Back to Home'),
            ),
          ],
        ),
      ),
    );
  }
}
