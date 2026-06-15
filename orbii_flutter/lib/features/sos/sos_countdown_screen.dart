import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/sos_service.dart';
import '../../state/location_provider.dart';
import 'active_sos_screen.dart';

/// SOS countdown — a cancellable timer before the alert fires. `instant: true`
/// (from the SOS long-press) skips straight to dispatch. Mirrors the RN
/// `SOSCountdown` screen. On fire it dispatches the SOS (sos_events insert +
/// broadcast) and hands off to the Active SOS screen.
class SosCountdownScreen extends ConsumerStatefulWidget {
  const SosCountdownScreen({super.key, this.instant = false});

  final bool instant;

  @override
  ConsumerState<SosCountdownScreen> createState() => _SosCountdownScreenState();
}

class _SosCountdownScreenState extends ConsumerState<SosCountdownScreen> {
  static const _start = 5;
  late int _seconds = widget.instant ? 0 : _start;
  Timer? _timer;
  bool _firing = false;

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

  Future<void> _fire() async {
    if (_firing) return;
    _timer?.cancel();
    setState(() => _firing = true);

    final loc = ref.read(locationProvider);
    final origin = loc.location ?? const LatLng(28.6139, 77.2090);
    final sosId = await SosService.dispatch(location: origin);
    if (!mounted) return;
    // Replace the countdown with the live incident screen.
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(
        builder: (_) => ActiveSosScreen(sosId: sosId, origin: origin),
      ),
    );
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
              const Icon(Icons.sos_rounded,
                  size: 72, color: AppColors.textInverse),
              const SizedBox(height: 24),
              Text(
                _firing ? 'Sending SOS…' : 'Sending SOS in',
                textAlign: TextAlign.center,
                style: AppTheme.bold(26, color: AppColors.textInverse),
              ),
              if (!_firing) ...[
                const SizedBox(height: 8),
                Text('$_seconds',
                    textAlign: TextAlign.center,
                    style: AppTheme.bold(72, color: AppColors.textInverse)),
              ],
              const Spacer(),
              if (!_firing)
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.textInverse,
                    foregroundColor: AppColors.coralDeep,
                  ),
                  onPressed: _cancel,
                  child: const Text("I'm safe — cancel"),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
