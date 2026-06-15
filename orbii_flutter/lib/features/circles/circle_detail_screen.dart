import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/auth_service.dart';
import '../../services/circles_service.dart';
import '../../services/users_service.dart';
import '../../state/circles_provider.dart';

/// Circle detail — members, invites (by username or phone), and leave/delete.
/// Phone invites resolve the user through `find_user_by_phone` (never a direct
/// phone query) before creating the invite.
class CircleDetailScreen extends ConsumerWidget {
  const CircleDetailScreen({super.key, required this.circle});

  final Circle circle;

  bool get _isOwner =>
      AuthService.currentSession?.user.id == circle.ownerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final members = ref.watch(circleMembersProvider(circle.id));

    return Scaffold(
      appBar: AppBar(
        title: Text(circle.name),
        actions: [
          IconButton(
            icon: Icon(_isOwner ? Icons.delete_outline : Icons.logout),
            tooltip: _isOwner ? 'Delete circle' : 'Leave circle',
            onPressed: () => _leaveOrDelete(context, ref),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.peach,
        foregroundColor: AppColors.textPrimary,
        onPressed: () => _inviteSheet(context, ref),
        icon: const Icon(Icons.person_add_alt),
        label: const Text('Invite'),
      ),
      body: members.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load members.\n$e')),
        data: (list) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('${list.length} member${list.length == 1 ? '' : 's'}',
                style: AppTheme.semibold(14)),
            const SizedBox(height: 8),
            for (final m in list)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppColors.lavenderSoft,
                    backgroundImage:
                        m.photoUrl != null ? NetworkImage(m.photoUrl!) : null,
                    child: m.photoUrl == null
                        ? const Icon(Icons.person,
                            color: AppColors.lavenderDeep, size: 18)
                        : null,
                  ),
                  title: Text(m.name ?? m.username ?? 'Member',
                      style: AppTheme.semibold(14)),
                  subtitle: m.username != null
                      ? Text('@${m.username}', style: AppTheme.medium(12))
                      : null,
                  trailing: m.role == 'owner'
                      ? const _RoleChip(label: 'Owner')
                      : null,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _leaveOrDelete(BuildContext context, WidgetRef ref) async {
    final controller = ref.read(circlesProvider.notifier);
    try {
      if (_isOwner) {
        await controller.remove(circle.id);
      } else {
        await controller.leave(circle.id);
      }
      if (context.mounted) context.pop();
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _inviteSheet(BuildContext context, WidgetRef ref) async {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.cream,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            ListTile(
              leading: const Icon(Icons.alternate_email),
              title: const Text('Invite by username'),
              onTap: () {
                Navigator.pop(context);
                _inviteByUsername(context, ref);
              },
            ),
            ListTile(
              leading: const Icon(Icons.phone_outlined),
              title: const Text('Invite by phone number'),
              onTap: () {
                Navigator.pop(context);
                _inviteByPhone(context, ref);
              },
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  Future<void> _inviteByUsername(BuildContext context, WidgetRef ref) async {
    final value = await _promptText(
      context,
      title: 'Invite by username',
      hint: 'username',
    );
    if (value == null || value.isEmpty || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await CirclesService.inviteByUsername(circle.id, value);
      messenger.showSnackBar(SnackBar(
          content: Text('Invite sent to @${value.replaceFirst('@', '')}')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _inviteByPhone(BuildContext context, WidgetRef ref) async {
    final value = await _promptText(
      context,
      title: 'Invite by phone',
      hint: '+9198…',
      keyboard: TextInputType.phone,
    );
    if (value == null || value.isEmpty || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      // Resolve via the SECURITY DEFINER RPC first (never a direct phone read).
      final uid = AuthService.currentSession?.user.id;
      final found = await UsersService.findByPhone(value, excludeUid: uid);
      await CirclesService.inviteByPhone(circle.id, value);
      messenger.showSnackBar(SnackBar(
        content: Text(found != null
            ? 'Invite sent to ${found.name ?? '@${found.username}'}'
            : 'Invite saved — they\'ll see it when they join ORBII.'),
      ));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<String?> _promptText(
    BuildContext context, {
    required String title,
    required String hint,
    TextInputType keyboard = TextInputType.text,
  }) {
    final ctrl = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: keyboard,
          decoration: InputDecoration(hintText: hint),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, ctrl.text.trim()),
              child: const Text('Send')),
        ],
      ),
    );
  }

}

class _RoleChip extends StatelessWidget {
  const _RoleChip({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.sageSoft,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(label,
          style: AppTheme.semibold(11, color: AppColors.sageDeep)),
    );
  }
}
