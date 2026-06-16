import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../router/app_router.dart';
import '../../services/community_service.dart';
import '../../state/circles_provider.dart';
import '../../state/location_provider.dart';

/// Notifications inbox — pending circle invites + recent nearby SOS alerts.
/// Emergency + circle activity only (no social feed).
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invites = ref.watch(incomingInvitesProvider);
    final viewer = ref.watch(locationProvider).location;

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(incomingInvitesProvider),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ── Circle invites ──
            invites.maybeWhen(
              data: (list) => list.isEmpty
                  ? const SizedBox.shrink()
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Circle invites', style: AppTheme.semibold(14)),
                        const SizedBox(height: 8),
                        for (final _ in list)
                          Card(
                            color: AppColors.peachSoft,
                            margin: const EdgeInsets.only(bottom: 8),
                            child: ListTile(
                              leading: const Icon(Icons.group_add,
                                  color: AppColors.peachDeep),
                              title: Text('Circle invitation',
                                  style: AppTheme.semibold(14)),
                              subtitle: Text('Tap to review in Circles',
                                  style: AppTheme.medium(12)),
                              onTap: () => context.push(Routes.circles),
                            ),
                          ),
                        const SizedBox(height: 16),
                      ],
                    ),
              orElse: () => const SizedBox.shrink(),
            ),

            // ── Nearby alerts ──
            Text('Nearby alerts', style: AppTheme.semibold(14)),
            const SizedBox(height: 8),
            FutureBuilder(
              future: viewer == null
                  ? Future.value(const <CommunityAlert>[])
                  : CommunityService.listNearbyAlerts(viewer, radiusKm: 5),
              builder: (context, snap) {
                final alerts = snap.data ?? const <CommunityAlert>[];
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                if (alerts.isEmpty) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Center(
                      child: Column(
                        children: [
                          const Icon(Icons.shield_outlined,
                              size: 40, color: AppColors.sage),
                          const SizedBox(height: 8),
                          Text('All clear nearby',
                              style: AppTheme.semibold(15)),
                        ],
                      ),
                    ),
                  );
                }
                return Column(
                  children: [
                    for (final a in alerts)
                      Card(
                        color: AppColors.coralSoft,
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: const Icon(Icons.priority_high,
                              color: AppColors.coralDeep),
                          title: Text('${a.victim.name} needs help',
                              style: AppTheme.semibold(14)),
                          subtitle: Text(
                            a.distanceMeters >= 0
                                ? '${(a.distanceMeters / 1000).toStringAsFixed(1)} km away'
                                : 'Nearby',
                            style: AppTheme.medium(12),
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => context.push(Routes.community),
                        ),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}
