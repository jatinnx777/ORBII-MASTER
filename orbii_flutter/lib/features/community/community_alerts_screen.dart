import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/auth_service.dart';
import '../../services/community_service.dart';
import '../../state/location_provider.dart';

/// Community = emergency response ONLY. A live list of nearby SOS alerts the
/// user can respond to. No feed, no chat, no forum. Faithful port of the RN
/// CommunityAlerts flow (broadcast + sos_events backfill).
class CommunityAlertsScreen extends ConsumerStatefulWidget {
  const CommunityAlertsScreen({super.key});

  @override
  ConsumerState<CommunityAlertsScreen> createState() =>
      _CommunityAlertsScreenState();
}

class _CommunityAlertsScreenState
    extends ConsumerState<CommunityAlertsScreen> {
  final _alerts = <String, CommunityAlert>{};
  RealtimeChannel? _sub;
  final _responded = <String>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  Future<void> _start() async {
    final viewer = ref.read(locationProvider).location;
    final uid = AuthService.currentSession?.user.id;

    // Backfill recent alerts (responder may have been backgrounded).
    if (viewer != null) {
      final recent = await CommunityService.listNearbyAlerts(
        viewer,
        radiusKm: 5,
        excludeUserId: uid,
      );
      if (!mounted) return;
      setState(() {
        for (final a in recent) {
          _alerts[a.id] = a;
        }
      });
    }

    // Live subscription.
    _sub = CommunityService.subscribeToAlerts(
      viewer: viewer,
      excludeUserId: uid,
      onAlert: (a) {
        if (!mounted) return;
        setState(() => _alerts[a.id] = a);
      },
    );
  }

  @override
  void dispose() {
    final sub = _sub;
    if (sub != null) CommunityService.dispose(sub);
    super.dispose();
  }

  Future<void> _respond(CommunityAlert a) async {
    final session = AuthService.currentSession;
    if (session == null) return;
    setState(() => _responded.add(a.id));
    await CommunityService.respondToAlert(
      alertId: a.id,
      userId: session.user.id,
      name: session.user.userMetadata?['full_name'] as String? ?? 'A helper',
      photoUri: session.user.userMetadata?['avatar_url'] as String?,
    );
  }

  @override
  Widget build(BuildContext context) {
    final alerts = _alerts.values.toList()
      ..sort((a, b) => a.distanceMeters.compareTo(b.distanceMeters));

    return Scaffold(
      appBar: AppBar(title: const Text('Nearby Alerts')),
      body: alerts.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.shield_outlined,
                      size: 48, color: AppColors.sage),
                  const SizedBox(height: 12),
                  Text('All clear nearby', style: AppTheme.semibold(16)),
                  const SizedBox(height: 4),
                  Text('You\'ll be alerted if someone needs help.',
                      style: AppTheme.medium(13)),
                ],
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: alerts.length,
              itemBuilder: (_, i) {
                final a = alerts[i];
                final responded = _responded.contains(a.id);
                return Card(
                  color: AppColors.coralSoft,
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        const CircleAvatar(
                          backgroundColor: AppColors.coral,
                          child: Icon(Icons.priority_high,
                              color: AppColors.textInverse),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${a.victim.name} needs help',
                                  style: AppTheme.semibold(15)),
                              Text(
                                a.distanceMeters >= 0
                                    ? '${(a.distanceMeters / 1000).toStringAsFixed(1)} km away'
                                    : 'Nearby',
                                style: AppTheme.medium(12),
                              ),
                            ],
                          ),
                        ),
                        FilledButton(
                          onPressed: responded ? null : () => _respond(a),
                          child: Text(responded ? 'On the way' : 'Respond'),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }
}
