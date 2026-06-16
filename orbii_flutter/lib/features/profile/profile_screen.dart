import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../core/widgets/orbii_dialog.dart';
import '../../router/app_router.dart';
import '../../services/auth_service.dart';
import '../../services/profile_service.dart';
import '../premium/widgets/premium_badge.dart';

/// Profile tab — identity, ORBII Plus badge, name edit, and entry points to
/// History / Settings / About / Safe Mode.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  UserProfile? _profile;
  bool _loading = true;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final p = await ProfileService.load();
    if (!mounted) return;
    setState(() {
      _profile = p;
      _loading = false;
    });
  }

  Future<void> _editName() async {
    final value = await showOrbiiPrompt(
      context,
      title: 'Your name',
      hint: 'Full name',
      initial: _profile?.name ?? '',
      icon: Icons.person_outline,
    );
    if (value == null || value.isEmpty) return;
    await ProfileService.updateName(value);
    await _load();
  }

  String _toE164(String input) {
    var s = input.trim().replaceAll(RegExp(r'[\s\-()]'), '');
    if (s.startsWith('+')) return s;
    s = s.replaceFirst(RegExp(r'^0+'), '');
    if (s.length == 10) return '+91$s';
    return '+$s';
  }

  Future<void> _editPhone() async {
    final value = await showOrbiiPrompt(
      context,
      title: 'Phone number',
      subtitle: 'Used so friends can add you to their circle.',
      hint: '+9198…',
      initial: _profile?.phone ?? '',
      icon: Icons.phone_outlined,
      keyboard: TextInputType.phone,
    );
    if (value == null || value.isEmpty) return;
    await ProfileService.updatePhone(_toE164(value));
    await _load();
  }

  Future<void> _changePhoto() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 512,
      imageQuality: 85,
    );
    if (picked == null) return;
    setState(() => _uploading = true);
    final url = await ProfileService.uploadAvatar(picked.path);
    if (!mounted) return;
    setState(() => _uploading = false);
    if (url == null) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not upload photo.')));
      return;
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final p = _profile;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // ── Identity card ──
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    children: [
                      GestureDetector(
                        onTap: _uploading ? null : _changePhoto,
                        child: Stack(
                          children: [
                            CircleAvatar(
                              radius: 30,
                              backgroundColor: AppColors.peachSoft,
                              backgroundImage: p?.photoUrl != null
                                  ? NetworkImage(p!.photoUrl!)
                                  : null,
                              child: p?.photoUrl == null
                                  ? Text(p?.initial ?? '?',
                                      style: AppTheme.bold(22,
                                          color: AppColors.peachDeep))
                                  : null,
                            ),
                            if (_uploading)
                              const Positioned.fill(
                                child: CircleAvatar(
                                  radius: 30,
                                  backgroundColor: Color(0x88000000),
                                  child: SizedBox(
                                    height: 20,
                                    width: 20,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: AppColors.textInverse),
                                  ),
                                ),
                              )
                            else
                              Positioned(
                                right: 0,
                                bottom: 0,
                                child: Container(
                                  padding: const EdgeInsets.all(4),
                                  decoration: const BoxDecoration(
                                    color: AppColors.peach,
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(Icons.camera_alt,
                                      size: 12, color: AppColors.textPrimary),
                                ),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(p?.name ?? 'ORBII user',
                                      style: AppTheme.bold(18),
                                      overflow: TextOverflow.ellipsis),
                                ),
                                const SizedBox(width: 8),
                                const PremiumBadge(compact: true),
                              ],
                            ),
                            Text(p?.email ?? p?.phone ?? '',
                                style: AppTheme.medium(12)),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.edit_outlined),
                        onPressed: _editName,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),

                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: const Icon(Icons.phone_outlined,
                        color: AppColors.textPrimary),
                    title: Text('Phone number', style: AppTheme.semibold(14)),
                    subtitle: Text(p?.phone ?? 'Add your number',
                        style: AppTheme.medium(12)),
                    trailing: const Icon(Icons.edit_outlined, size: 18),
                    onTap: _editPhone,
                  ),
                ),
                _NavTile(
                  icon: Icons.history,
                  label: 'SOS History',
                  onTap: () => context.push(Routes.history),
                ),
                _NavTile(
                  icon: Icons.notifications_outlined,
                  label: 'Notifications',
                  onTap: () => context.push(Routes.notifications),
                ),
                _NavTile(
                  icon: Icons.bolt_outlined,
                  label: 'Safe Mode',
                  onTap: () => context.push(Routes.safeMode),
                ),
                _NavTile(
                  icon: Icons.settings_outlined,
                  label: 'Settings',
                  onTap: () => context.push(Routes.settings),
                ),
                _NavTile(
                  icon: Icons.info_outline,
                  label: 'About ORBII',
                  onTap: () => context.push(Routes.about),
                ),
                const SizedBox(height: 12),
                TextButton.icon(
                  onPressed: AuthService.signOut,
                  icon: const Icon(Icons.logout, color: AppColors.coralDeep),
                  label: Text('Sign out',
                      style:
                          AppTheme.semibold(14, color: AppColors.coralDeep)),
                ),
              ],
            ),
    );
  }
}

class _NavTile extends StatelessWidget {
  const _NavTile({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(icon, color: AppColors.textPrimary),
        title: Text(label, style: AppTheme.semibold(14)),
        trailing: const Icon(Icons.chevron_right, color: AppColors.textMuted),
        onTap: onTap,
      ),
    );
  }
}
