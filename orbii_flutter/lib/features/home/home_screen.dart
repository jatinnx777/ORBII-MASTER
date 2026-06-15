import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../router/app_router.dart';
import '../../services/auth_service.dart';
import '../../state/location_provider.dart';
import '../../state/protection_provider.dart';
import '../../state/voice_provider.dart';
import '../../state/presence_provider.dart';
import '../../services/voice_guard_service.dart';
import '../../services/presence_service.dart';
import '../../services/community_service.dart';
import '../../state/subscription_provider.dart';
import '../premium/widgets/premium_badge.dart';
import 'widgets/helpers_card.dart';
import 'widgets/protection_strength.dart';
import 'widgets/sos_button.dart';
import 'widgets/voice_card.dart';

/// Home — map (60%) behind a fixed bottom sheet (42%), floating header on top.
/// Faithful port of the RN `HomeScreen` layout + Protection Strength feature.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _mapController = MapController();

  // Default map centre until a GPS fix arrives (New Delhi).
  static const _fallback = LatLng(28.6139, 77.2090);

  @override
  void initState() {
    super.initState();
    CommunityService.prewarm();
    WidgetsBinding.instance.addPostFrameCallback((_) => _joinPresence());
  }

  Future<void> _joinPresence() async {
    final session = AuthService.currentSession;
    if (session == null) return;
    await PresenceService.join(
      userId: session.user.id,
      name: session.user.userMetadata?['full_name'] as String? ?? 'You',
      photoUri: session.user.userMetadata?['avatar_url'] as String?,
      location: ref.read(locationProvider).location,
    );
  }

  void _publishPresence(LatLng location) {
    final session = AuthService.currentSession;
    if (session == null) return;
    PresenceService.update(
      userId: session.user.id,
      name: session.user.userMetadata?['full_name'] as String? ?? 'You',
      photoUri: session.user.userMetadata?['avatar_url'] as String?,
      location: location,
    );
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  Future<void> _fixFactor(String key) async {
    final protection = ref.read(protectionProvider.notifier);
    switch (key) {
      case 'battery':
      case 'autostart':
        await Permission.ignoreBatteryOptimizations.request();
        break;
      case 'notifications':
        await Permission.notification.request();
        break;
      case 'microphone':
        await Permission.microphone.request();
        break;
      case 'location':
        await ref.read(locationProvider.notifier).bootstrap();
        break;
      case 'voice':
      case 'background':
        await _toggleVoice();
        break;
      case 'contacts':
        _snack('Emergency contacts arrive in the next build.');
        break;
    }
    await protection.refresh();
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  /// Tap on the Voice card → arm (with a duration picker) or disarm the
  /// background Vosk guard. Mirrors RN `handleVoiceCard`.
  Future<void> _toggleVoice() async {
    final voice = ref.read(voiceProvider.notifier);
    if (ref.read(voiceProvider).enabled) {
      await voice.disarm();
      ref.read(protectionProvider.notifier).setVoice(
            voiceOn: false,
            backgroundOn: false,
          );
      return;
    }

    final hours = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: AppColors.cream,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 16),
            Text('Protect me for…', style: AppTheme.bold(18)),
            const SizedBox(height: 4),
            Text('ORBII keeps listening for your phrase, even in the background.',
                textAlign: TextAlign.center, style: AppTheme.medium(13)),
            const SizedBox(height: 8),
            for (final d in VoiceGuardService.durations)
              ListTile(
                title: Text(d.$1, style: AppTheme.semibold(15)),
                onTap: () => Navigator.of(context).pop(d.$2),
              ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
    if (hours == null) return;

    final result = await voice.arm(hours);
    if (!mounted) return;
    switch (result) {
      case ArmResult.armed:
        ref.read(protectionProvider.notifier).setVoice(
              voiceOn: true,
              backgroundOn: true,
            );
        _snack('Voice protection is on. Keep ORBII allowed to run in the background.');
      case ArmResult.micDenied:
        _snack('Microphone access is needed for Voice SOS.');
      case ArmResult.unavailable:
        _snack('Background protection runs on the installed Android app.');
    }
  }

  void _openProtectionSheet() {
    final state = ref.read(protectionProvider);
    ProtectionSheet.show(
      context,
      pct: state.pct,
      factors: state.factors,
      onFix: (key) {
        Navigator.of(context).pop();
        _fixFactor(key);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final loc = ref.watch(locationProvider);
    final protection = ref.watch(protectionProvider);
    final voiceOn = ref.watch(voiceProvider).enabled;
    final peers = ref.watch(presencePeersProvider).valueOrNull ?? const [];
    final center = loc.location ?? _fallback;
    final size = MediaQuery.of(context).size;
    final sheetHeight = size.height * 0.42;

    // Re-publish presence whenever our location changes (mirrors RN's
    // presence `update` on currentLocation change).
    ref.listen(locationProvider, (prev, next) {
      final here = next.location;
      if (here != null) _publishPresence(here);
    });

    // Peers near us (within the map radius), excluding self → map markers +
    // the "helpers nearby" count.
    final me = AuthService.currentSession?.user.id;
    const distance = Distance();
    final nearbyPeers = peers.where((p) {
      if (p.userId == me) return false;
      final pl = p.location;
      if (pl == null) return false;
      if (loc.location == null) return true;
      return distance.as(LengthUnit.Meter, loc.location!, pl) <= 5000;
    }).toList();

    return Scaffold(
      body: Stack(
        children: [
          // ── Map (full background) ──
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: center,
              initialZoom: 15,
              interactionOptions: const InteractionOptions(
                flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
              ),
            ),
            children: [
              TileLayer(
                // Free, no-key raster tiles. TODO(parity): swap to OpenFreeMap
                // vector (Liberty/warm) via vector_map_tiles to match RN.
                urlTemplate:
                    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.orbii.app',
              ),
              MarkerLayer(
                markers: [
                  // Nearby helpers / circle peers — green if verified-helper,
                  // lavender otherwise (mirrors RN pin colours).
                  for (final p in nearbyPeers)
                    Marker(
                      point: p.location!,
                      width: 22,
                      height: 22,
                      child: Container(
                        decoration: BoxDecoration(
                          color: p.isVerified
                              ? AppColors.sage
                              : AppColors.lavender,
                          shape: BoxShape.circle,
                          border:
                              Border.all(color: AppColors.surface, width: 2.5),
                        ),
                      ),
                    ),
                  if (loc.location != null)
                    Marker(
                      point: loc.location!,
                      width: 26,
                      height: 26,
                      child: Container(
                        decoration: BoxDecoration(
                          color: AppColors.coral,
                          shape: BoxShape.circle,
                          border:
                              Border.all(color: AppColors.surface, width: 3),
                          boxShadow: const [
                            BoxShadow(color: Color(0x33000000), blurRadius: 6),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),

          // ── Floating header ──
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
              child: _Header(
                onProfile: () => _snack('Profile arrives in a later phase.'),
                onAlerts: () => context.push(Routes.community),
                onSignOut: AuthService.signOut,
              ),
            ),
          ),

          // ── Bottom sheet ──
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              height: sheetHeight,
              width: double.infinity,
              decoration: const BoxDecoration(
                color: AppColors.cream,
                borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
                boxShadow: [
                  BoxShadow(
                      color: Color(0x1A000000),
                      blurRadius: 30,
                      offset: Offset(0, -8)),
                ],
              ),
              child: Column(
                children: [
                  const SizedBox(height: 8),
                  Container(
                    width: 40,
                    height: 5,
                    decoration: BoxDecoration(
                      color: AppColors.creamDeep,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
                      children: [
                        const _ProtectionHero(),
                        const SizedBox(height: 16),
                        ProtectionStrengthPill(
                          pct: protection.pct,
                          onTap: _openProtectionSheet,
                        ),
                        const SizedBox(height: 16),
                        if (!loc.granted)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: _PermissionBanner(
                              onTap: () => ref
                                  .read(locationProvider.notifier)
                                  .bootstrap(),
                            ),
                          ),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SosButton(
                              onPress: () =>
                                  context.push(Routes.sosCountdown),
                              onLongPress: () => context.push(
                                  '${Routes.sosCountdown}?instant=true'),
                            ),
                            const SizedBox(width: 16),
                            VoiceCard(
                              listening: voiceOn,
                              onTap: _toggleVoice,
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        HelpersCard(
                          count: nearbyPeers.length,
                          onTap: () => context.push(Routes.circles),
                        ),
                        if (!ref.watch(isPremiumProvider)) ...[
                          const SizedBox(height: 16),
                          _UpgradeCta(onTap: () => context.push(Routes.premium)),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// "Protected / All systems active" hero with a soft sage glow.
class _ProtectionHero extends StatelessWidget {
  const _ProtectionHero();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
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
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.sageSoft,
              borderRadius: BorderRadius.circular(26),
            ),
            child: const Icon(Icons.verified_user,
                size: 26, color: AppColors.sageDeep),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text('Protected', style: AppTheme.bold(24)),
                    const SizedBox(width: 8),
                    const PremiumBadge(compact: true),
                  ],
                ),
                Text('All systems active', style: AppTheme.medium(13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Slim "Upgrade to ORBII Plus" CTA shown to free users in the Home sheet.
class _UpgradeCta extends StatelessWidget {
  const _UpgradeCta({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFFFFE9B8), AppColors.peach],
          ),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          children: [
            const Icon(Icons.workspace_premium,
                color: AppColors.peachDeep, size: 22),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Upgrade to ORBII Plus', style: AppTheme.semibold(15)),
                  Text('Enhanced protection & priority features',
                      style: AppTheme.medium(12, color: AppColors.textPrimary)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: AppColors.textPrimary),
          ],
        ),
      ),
    );
  }
}

class _PermissionBanner extends StatelessWidget {
  const _PermissionBanner({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.sageSoft,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            const Icon(Icons.location_on, size: 18, color: AppColors.coralDeep),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Enable location for emergencies',
                  style: AppTheme.semibold(13)),
            ),
            const Icon(Icons.chevron_right,
                size: 16, color: AppColors.coralDeep),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.onProfile,
    required this.onAlerts,
    required this.onSignOut,
  });

  final VoidCallback onProfile;
  final VoidCallback onAlerts;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        _circleButton(Icons.person_outline, onProfile),
        Row(
          children: [
            _circleButton(Icons.notifications_outlined, onAlerts),
            const SizedBox(width: 8),
            _circleButton(Icons.logout, onSignOut),
          ],
        ),
      ],
    );
  }

  Widget _circleButton(IconData icon, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(22),
          boxShadow: const [
            BoxShadow(
                color: Color(0x14000000),
                blurRadius: 12,
                offset: Offset(0, 4)),
          ],
        ),
        child: Icon(icon, size: 20, color: AppColors.textPrimary),
      ),
    );
  }
}
