import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../core/widgets/orbii_dialog.dart';
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
              leading: const Icon(Icons.ios_share, color: AppColors.sageDeep),
              title: const Text('Share invite link'),
              subtitle: const Text('Send via WhatsApp, SMS, anywhere'),
              onTap: () {
                Navigator.pop(context);
                _shareInviteLink(context);
              },
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.phone_outlined),
              title: const Text('Invite by phone number'),
              onTap: () {
                Navigator.pop(context);
                _inviteByPhone(context, ref);
              },
            ),
            ListTile(
              leading: const Icon(Icons.alternate_email),
              title: const Text('Invite by username'),
              onTap: () {
                Navigator.pop(context);
                _inviteByUsername(context, ref);
              },
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  String _linkFor(String token) => 'https://orbii.app/join/$token';

  String _messageFor(String link) =>
      'Join my ORBII safety circle "${circle.name}". Tap to accept and share '
      'your live location during emergencies: $link';

  /// Create a generic share link for the circle and open the system share
  /// sheet (WhatsApp / SMS / anything). Works regardless of sql/18.
  Future<void> _shareInviteLink(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final invite = await CirclesService.createInviteLink(circle.id);
      final token = invite.token;
      if (token == null) {
        messenger.showSnackBar(
            const SnackBar(content: Text('Could not create invite link.')));
        return;
      }
      await Share.share(_messageFor(_linkFor(token)),
          subject: 'Join my ORBII safety circle');
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
    }
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
    final raw = await _promptText(
      context,
      title: 'Invite by phone',
      hint: '+9198…',
      keyboard: TextInputType.phone,
    );
    if (raw == null || raw.isEmpty || !context.mounted) return;
    final phone = _toE164(raw);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final uid = AuthService.currentSession?.user.id;
      // Best-effort: is this number already an ORBII user? (Won't throw even
      // if find_user_by_phone / sql/18 isn't installed.)
      final found = await UsersService.findByPhone(phone, excludeUid: uid);
      // Always create the invite so we get a token to share.
      final invite = await CirclesService.inviteByPhone(circle.id, phone);

      if (found != null) {
        messenger.showSnackBar(SnackBar(
            content: Text(
                'Invite sent to ${found.name ?? '@${found.username}'} — they\'ll see it in ORBII.')));
      }
      // Offer to share the link via WhatsApp/SMS regardless (covers people not
      // on ORBII yet — the main use case).
      final token = invite.token;
      if (token != null) {
        await Share.share(_messageFor(_linkFor(token)),
            subject: 'Join my ORBII safety circle');
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// Normalise a typed number to E.164. Adds +91 (India) when no country code
  /// is present, matching the RN `toE164India` helper.
  String _toE164(String input) {
    var s = input.trim().replaceAll(RegExp(r'[\s\-()]'), '');
    if (s.startsWith('+')) return s;
    s = s.replaceFirst(RegExp(r'^0+'), '');
    if (s.length == 10) return '+91$s';
    return '+$s';
  }

  Future<String?> _promptText(
    BuildContext context, {
    required String title,
    required String hint,
    TextInputType keyboard = TextInputType.text,
  }) {
    return showOrbiiPrompt(
      context,
      title: title,
      hint: hint,
      confirmLabel: 'Send',
      icon: Icons.person_add_alt,
      keyboard: keyboard,
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
