import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';

/// Settings — quick access to the OS permission screens ORBII relies on. (The
/// app requests each permission in-flow; this is the manual override.)
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Permissions', style: AppTheme.semibold(14)),
          const SizedBox(height: 8),
          _tile(Icons.location_on_outlined, 'Location',
              'Required to dispatch helpers during an emergency'),
          _tile(Icons.mic_none, 'Microphone',
              'For hands-free Voice SOS'),
          _tile(Icons.notifications_outlined, 'Notifications',
              'Emergency + helper alerts'),
          const SizedBox(height: 20),
          Card(
            child: ListTile(
              leading: const Icon(Icons.tune, color: AppColors.textPrimary),
              title: Text('Open app settings', style: AppTheme.semibold(14)),
              subtitle: Text('Manage all ORBII permissions',
                  style: AppTheme.medium(12)),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: openAppSettings,
            ),
          ),
        ],
      ),
    );
  }

  Widget _tile(IconData icon, String title, String subtitle) => Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          leading: Icon(icon, color: AppColors.textPrimary),
          title: Text(title, style: AppTheme.semibold(14)),
          subtitle: Text(subtitle, style: AppTheme.medium(12)),
          trailing: const Icon(Icons.chevron_right, color: AppColors.textMuted),
          onTap: openAppSettings,
        ),
      );
}
