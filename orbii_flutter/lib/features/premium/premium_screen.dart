import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/payment_service.dart';
import '../../state/subscription_provider.dart';

/// Plan id + display data — mirrors the RN tiers (Free, Solo ₹99, Family ₹299).
class _Plan {
  const _Plan({
    required this.id,
    required this.name,
    required this.price,
    required this.tagline,
    required this.features,
    this.badge,
    this.valueNote,
    this.highlight = false,
  });
  final String id;
  final String name;
  final int price;
  final String tagline;
  final List<String> features;
  final String? badge;
  final String? valueNote;
  final bool highlight;
}

const _plans = <_Plan>[
  _Plan(
    id: 'free',
    name: 'Free',
    price: 0,
    tagline: 'Everything you need to stay safe.',
    features: [
      'Emergency SOS',
      'Live Location',
      'Nearby Helpers',
      'Emergency Contacts',
      '2 Voice SOS activations / month',
    ],
  ),
  _Plan(
    id: 'solo',
    name: 'Solo',
    price: 99,
    tagline: 'Hands-free protection, always on.',
    highlight: true,
    badge: 'RECOMMENDED',
    features: [
      'Everything in Free',
      'Unlimited Voice SOS',
      'Priority Alerts',
      'Advanced safety features',
    ],
  ),
  _Plan(
    id: 'family',
    name: 'Family',
    price: 299,
    tagline: 'Protect everyone you love.',
    badge: 'BEST FOR FAMILIES',
    valueNote: 'Just ₹75 per person',
    features: [
      'Up to 4 family members',
      'Shared safety circle',
      'Unlimited Voice SOS',
      'Family dashboard',
    ],
  ),
];

class PremiumScreen extends ConsumerStatefulWidget {
  const PremiumScreen({super.key});

  @override
  ConsumerState<PremiumScreen> createState() => _PremiumScreenState();
}

class _PremiumScreenState extends ConsumerState<PremiumScreen> {
  final _payments = PaymentService();
  String _selected = 'solo';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _payments.dispose();
    super.dispose();
  }

  Future<void> _upgrade() async {
    if (_selected == 'free') return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await _payments.purchase(_selected);
    if (!mounted) return;
    setState(() => _busy = false);
    switch (result.status) {
      case PaymentStatus.success:
        await ref.read(subscriptionProvider.notifier).refresh();
        if (mounted) _celebrate();
      case PaymentStatus.cancelled:
        setState(() => _error = 'Checkout cancelled. Try again anytime.');
      case PaymentStatus.failed:
        setState(() => _error = result.message ?? 'Payment failed. Please retry.');
    }
  }

  void _celebrate() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => _CelebrationDialog(onDone: () => Navigator.pop(context)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isPremium = ref.watch(isPremiumProvider);
    final selected = _plans.firstWhere((p) => p.id == _selected);

    return Scaffold(
      appBar: AppBar(title: const Text('Plans'), automaticallyImplyLeading: false),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        children: [
          Text(isPremium ? 'You\'re protected' : 'Choose your plan',
              style: AppTheme.bold(24)),
          const SizedBox(height: 4),
          Text(
            isPremium
                ? 'Thank you for being an ORBII member.'
                : 'Upgrade anytime. Cancel anytime.',
            style: AppTheme.medium(13),
          ),
          const SizedBox(height: 20),

          for (final p in _plans)
            _PlanCard(
              plan: p,
              selected: _selected == p.id,
              onTap: () => setState(() => _selected = p.id),
            ),

          if (_error != null) ...[
            const SizedBox(height: 6),
            Text(_error!,
                textAlign: TextAlign.center,
                style: AppTheme.medium(13, color: AppColors.coralDeep)),
          ],
          const SizedBox(height: 16),

          if (isPremium)
            _activeBanner()
          else if (_selected != 'free')
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
                          strokeWidth: 2, color: AppColors.textInverse))
                  : Text('Upgrade to ${selected.name} · ₹${selected.price}/mo'),
            ),

          const SizedBox(height: 12),
          Text('Test mode — use any Razorpay test card.',
              textAlign: TextAlign.center,
              style: AppTheme.medium(11, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  Widget _activeBanner() => Container(
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
            Text('Your plan is active',
                style: AppTheme.semibold(15, color: AppColors.sageDeep)),
          ],
        ),
      );
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.plan,
    required this.selected,
    required this.onTap,
  });
  final _Plan plan;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = plan.highlight ? AppColors.peachDeep : AppColors.sage;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: selected ? accent : const Color(0x14000000),
            width: selected ? 2 : 1,
          ),
          boxShadow: selected
              ? [BoxShadow(color: accent.withValues(alpha: 0.18), blurRadius: 20, offset: const Offset(0, 8))]
              : const [BoxShadow(color: Color(0x0F000000), blurRadius: 12, offset: Offset(0, 4))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(plan.name, style: AppTheme.bold(19)),
                const SizedBox(width: 8),
                if (plan.badge != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: accent.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(plan.badge!,
                        style: AppTheme.semibold(9.5, color: accent)),
                  ),
                const Spacer(),
                AnimatedScale(
                  scale: selected ? 1 : 0,
                  duration: const Duration(milliseconds: 180),
                  child: Icon(Icons.check_circle, color: accent, size: 22),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(plan.tagline, style: AppTheme.medium(12)),
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(plan.price == 0 ? '₹0' : '₹${plan.price}',
                    style: AppTheme.bold(26)),
                Text(plan.price == 0 ? '' : ' /month', style: AppTheme.medium(12)),
                if (plan.valueNote != null) ...[
                  const Spacer(),
                  Text(plan.valueNote!,
                      style: AppTheme.semibold(11, color: AppColors.sageDeep)),
                ],
              ],
            ),
            const SizedBox(height: 12),
            for (final f in plan.features)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    Icon(Icons.check, size: 16, color: accent),
                    const SizedBox(width: 8),
                    Expanded(
                        child: Text(f,
                            style: AppTheme.medium(13, color: AppColors.textPrimary))),
                  ],
                ),
              ),
          ],
        ),
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
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
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
            Text('Welcome aboard!', style: AppTheme.bold(20)),
            const SizedBox(height: 6),
            Text('Your premium protection is now active. Stay safe out there.',
                textAlign: TextAlign.center, style: AppTheme.medium(13)),
            const SizedBox(height: 24),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.peach,
                foregroundColor: AppColors.textPrimary,
                minimumSize: const Size.fromHeight(48),
              ),
              onPressed: onDone,
              child: const Text('Done'),
            ),
          ],
        ),
      ),
    );
  }
}
