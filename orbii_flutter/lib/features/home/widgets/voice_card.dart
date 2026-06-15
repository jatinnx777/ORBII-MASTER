import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/theme/colors.dart';

/// Voice SOS card — lavender. In Phase 2 this toggles a placeholder; the real
/// foreground + background voice engine (Vosk via MethodChannel) lands in
/// Phase 3. Visual + waveform match the RN `VoiceCard`.
class VoiceCard extends StatelessWidget {
  const VoiceCard({super.key, required this.listening, required this.onTap});

  final bool listening;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          height: 156,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.lavenderSoft,
            borderRadius: BorderRadius.circular(24),
          ),
          child: Column(
            children: [
              Text('Voice SOS',
                  style: AppTheme.semibold(16, color: AppColors.lavenderDeep)),
              const SizedBox(height: 2),
              Text(listening ? 'Protecting you' : 'Tap to turn on',
                  style: AppTheme.medium(12)),
              const Spacer(),
              _Waveform(active: listening),
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}

class _Waveform extends StatefulWidget {
  const _Waveform({required this.active});
  final bool active;

  @override
  State<_Waveform> createState() => _WaveformState();
}

class _WaveformState extends State<_Waveform>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 600),
  );

  @override
  void initState() {
    super.initState();
    if (widget.active) _c.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(covariant _Waveform old) {
    super.didUpdateWidget(old);
    if (widget.active && !_c.isAnimating) {
      _c.repeat(reverse: true);
    } else if (!widget.active && _c.isAnimating) {
      _c.stop();
      _c.value = 0;
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(18, (i) {
            final base = 6 + (i % 5) * 3.0;
            final peak = base + 14;
            final h = widget.active ? base + (peak - base) * _c.value : base;
            return Container(
              width: 3,
              height: h,
              margin: const EdgeInsets.symmetric(horizontal: 1.5),
              decoration: BoxDecoration(
                color: AppColors.lavender,
                borderRadius: BorderRadius.circular(2),
              ),
            );
          }),
        );
      },
    );
  }
}
