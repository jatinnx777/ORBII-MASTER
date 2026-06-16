import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';

/// About ORBII — mission + version.
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('About ORBII')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 12),
          Center(
            child: Container(
              width: 84,
              height: 84,
              decoration: BoxDecoration(
                color: AppColors.goldSoft,
                borderRadius: BorderRadius.circular(24),
              ),
              child: const Icon(Icons.shield_outlined,
                  size: 42, color: AppColors.goldDeep),
            ),
          ),
          const SizedBox(height: 16),
          Center(child: Text('ORBII', style: AppTheme.bold(26, color: AppColors.coral))),
          const SizedBox(height: 4),
          Center(child: Text('Your safety, always within reach.',
              style: AppTheme.medium(13))),
          const SizedBox(height: 28),
          Text(
            'ORBII is a women\'s safety companion: hands-free Voice SOS, '
            'trusted Safety Circles, and nearby helpers — built to get you '
            'help fast when it matters most.',
            style: AppTheme.medium(14, color: AppColors.textPrimary),
          ),
          const SizedBox(height: 24),
          Card(
            child: ListTile(
              title: Text('Version', style: AppTheme.semibold(14)),
              trailing: Text('1.0.0 (Flutter)', style: AppTheme.medium(13)),
            ),
          ),
        ],
      ),
    );
  }
}
