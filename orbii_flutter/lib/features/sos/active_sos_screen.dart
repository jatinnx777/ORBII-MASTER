import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/live_location_service.dart';
import '../../services/sos_recording_service.dart';
import '../../services/sos_service.dart';
import '../../state/location_provider.dart';

/// Active SOS (victim view). The alert is already dispatched + broadcast; this
/// screen records audio, shows responders moving in via live-location, and
/// lets the user resolve ("I'm safe"). Closes the Phase 4 live-location item.
class ActiveSosScreen extends ConsumerStatefulWidget {
  const ActiveSosScreen({super.key, required this.sosId, required this.origin});

  final String sosId;
  final LatLng origin;

  @override
  ConsumerState<ActiveSosScreen> createState() => _ActiveSosScreenState();
}

class _ActiveSosScreenState extends ConsumerState<ActiveSosScreen> {
  final _recorder = SosRecordingService();
  RealtimeChannel? _liveSub;
  final _responders = <String, LiveLocationUpdate>{};
  bool _resolving = false;

  @override
  void initState() {
    super.initState();
    _recorder.start(widget.sosId);
    _liveSub = LiveLocationService.subscribe(widget.sosId, (update) {
      if (!mounted) return;
      setState(() => _responders[update.responder.id] = update);
    });
  }

  Future<void> _resolve() async {
    setState(() => _resolving = true);
    final path = await _recorder.stop();
    if (path != null) {
      await SosService.uploadRecording(widget.sosId, path);
    }
    await SosService.resolve(widget.sosId);
    if (!mounted) return;
    context.go('/');
  }

  @override
  void dispose() {
    final sub = _liveSub;
    if (sub != null) Supabase.instance.client.removeChannel(sub);
    _recorder.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(locationProvider).location ?? widget.origin;
    final responders = _responders.values.toList();

    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            options: MapOptions(initialCenter: me, initialZoom: 15),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.orbii.app',
              ),
              MarkerLayer(
                markers: [
                  Marker(
                    point: me,
                    width: 28,
                    height: 28,
                    child: const _Dot(color: AppColors.coral, size: 28),
                  ),
                  for (final r in responders)
                    Marker(
                      point: r.point,
                      width: 24,
                      height: 24,
                      child: const _Dot(color: AppColors.sage, size: 24),
                    ),
                ],
              ),
            ],
          ),

          // ── Status banner ──
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.coral,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: const [
                    BoxShadow(color: Color(0x33FF6B57), blurRadius: 16),
                  ],
                ),
                child: Row(
                  children: [
                    const Icon(Icons.sos_rounded, color: AppColors.textInverse),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('SOS active',
                              style: AppTheme.bold(18,
                                  color: AppColors.textInverse)),
                          Text(
                            responders.isEmpty
                                ? 'Alerting people nearby… recording audio'
                                : '${responders.length} responding — help is coming',
                            style: AppTheme.medium(12,
                                color: const Color(0xE6FFFFFF)),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // ── Resolve button ──
          Align(
            alignment: Alignment.bottomCenter,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.sage,
                    foregroundColor: AppColors.textInverse,
                    minimumSize: const Size.fromHeight(54),
                  ),
                  onPressed: _resolving ? null : _resolve,
                  child: _resolving
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppColors.textInverse),
                        )
                      : const Text("I'm safe — end SOS"),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.color, required this.size});
  final Color color;
  final double size;
  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.surface, width: 3),
      ),
    );
  }
}
