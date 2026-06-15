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
  bool _voiceOn = false;

  // Default map centre until a GPS fix arrives (New Delhi).
  static const _fallback = LatLng(28.6139, 77.2090);

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
        _snack('Voice SOS setup arrives in the next build.');
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
    final center = loc.location ?? _fallback;
    final size = MediaQuery.of(context).size;
    final sheetHeight = size.height * 0.42;

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
              if (loc.location != null)
                MarkerLayer(
                  markers: [
                    Marker(
                      point: loc.location!,
                      width: 26,
                      height: 26,
                      child: Container(
                        decoration: BoxDecoration(
                          color: AppColors.coral,
                          shape: BoxShape.circle,
                          border: Border.all(
                              color: AppColors.surface, width: 3),
                          boxShadow: const [
                            BoxShadow(
                                color: Color(0x33000000), blurRadius: 6),
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
                onSettings: () => _snack('Settings arrive in a later phase.'),
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
                              listening: _voiceOn,
                              onTap: () {
                                setState(() => _voiceOn = !_voiceOn);
                                _snack(
                                    'Full Voice SOS engine arrives in the next build.');
                              },
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        HelpersCard(
                          count: 0,
                          onTap: () =>
                              _snack('Circles arrive in a later phase.'),
                        ),
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
                Text('Protected', style: AppTheme.bold(24)),
                Text('All systems active', style: AppTheme.medium(13)),
              ],
            ),
          ),
        ],
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
    required this.onSettings,
    required this.onSignOut,
  });

  final VoidCallback onProfile;
  final VoidCallback onSettings;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        _circleButton(Icons.person_outline, onProfile),
        Row(
          children: [
            _circleButton(Icons.notifications_outlined, onSettings),
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
