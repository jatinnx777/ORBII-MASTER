import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/colors.dart';
import '../../state/shell_provider.dart';
import '../home/home_screen.dart';
import '../safety/safety_screen.dart';
import '../premium/premium_screen.dart';
import '../profile/profile_screen.dart';

/// Bottom-nav shell — the four primary tabs (Home / Safety / Plans / Profile).
/// The active tab is held in [shellTabProvider] so any screen can switch tabs.
class AppShell extends ConsumerWidget {
  const AppShell({super.key});

  static const _tabs = [
    HomeScreen(),
    SafetyScreen(),
    PremiumScreen(),
    ProfileScreen(),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final index = ref.watch(shellTabProvider);
    return Scaffold(
      body: IndexedStack(index: index, children: _tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) =>
            ref.read(shellTabProvider.notifier).state = i,
        backgroundColor: AppColors.surface,
        indicatorColor: AppColors.sageSoft,
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home),
              label: 'Home'),
          NavigationDestination(
              icon: Icon(Icons.shield_outlined),
              selectedIcon: Icon(Icons.shield),
              label: 'Safety'),
          NavigationDestination(
              icon: Icon(Icons.workspace_premium_outlined),
              selectedIcon: Icon(Icons.workspace_premium),
              label: 'Plans'),
          NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: 'Profile'),
        ],
      ),
    );
  }
}
