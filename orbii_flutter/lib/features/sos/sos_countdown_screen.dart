import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';

/// SOS countdown — a cancellable timer before the alert fires. `instant: true`
/// (from the SOS long-press) skips straight to triggered. Mirrors the RN
/// `SOSCountdown` screen. The actual dispatch (sos_events insert, audio
/// recording, live-location broadcast) is wired when those services are ported;
/// here we own the countdown UX + cancel guard.
class SosCountdownScreen extends StatefulWidget {
  const SosCountdownScreen({super.key, this.instant = false});

  final bool instant;

  @override
  State<SosCountdownScreen> createState() => _SosCountdownScreenState();
}

class _SosCountdownScreenState extends State<SosCountdownScreen> {
  static const _start = 5;
  late int _seconds = widget.instant ? 0 : _start;
  Timer? _timer;
  bool _fired = false;

  @override
  void initState() {
    super.initState();
    if (widget.instant) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _fire());
    } else {
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        setState(() => _seconds--);
        if (_seconds <= 0) _fire();
      });
    }
  }

  void _fire() {
    _timer?.cancel();
    setState(() => _fired = true);
    // TODO(phase): dispatch SOS — insert sos_events, start audio recording,
    // begin live-location broadcast, notify circle. Ported with sos service.
  }

  void _cancel() {
    _timer?.cancel();
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/');
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.coral,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              Icon(_fired ? Icons.check_circle_outline : Icons.sos_rounded,
                  size: 72, color: AppColors.textInverse),
              const SizedBox(height: 24),
              Text(
                _fired ? 'SOS sent' : 'Sending SOS in',
                textAlign: TextAlign.center,
                style: AppTheme.bold(26, color: AppColors.textInverse),
              ),
              if (!_fired) ...[
                const SizedBox(height: 8),
                Text('$_seconds',
                    textAlign: TextAlign.center,
                    style: AppTheme.bold(72, color: AppColors.textInverse)),
              ] else ...[
                const SizedBox(height: 8),
                Text('Your trusted contacts are being alerted.',
                    textAlign: TextAlign.center,
                    style: AppTheme.medium(14, color: const Color(0xE6FFFFFF))),
              ],
              const Spacer(),
              if (!_fired)
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.textInverse,
                    foregroundColor: AppColors.coralDeep,
                  ),
                  onPressed: _cancel,
                  child: const Text("I'm safe — cancel"),
                )
              else
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.textInverse,
                    foregroundColor: AppColors.coralDeep,
                  ),
                  onPressed: () => context.go('/'),
                  child: const Text('Done'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
