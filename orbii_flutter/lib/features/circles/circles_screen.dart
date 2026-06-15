import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/circles_service.dart';
import '../../state/circles_provider.dart';

/// Safety Circles list — create, open, and accept pending invites. Trusted
/// groups only; no social graph.
class CirclesScreen extends ConsumerWidget {
  const CirclesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final circles = ref.watch(circlesProvider);
    final invites = ref.watch(incomingInvitesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Safety Circles')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: AppColors.peach,
        foregroundColor: AppColors.textPrimary,
        onPressed: () => _createDialog(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('New circle'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(circlesProvider.notifier).refresh();
          ref.invalidate(incomingInvitesProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ── pending invites ──
            invites.maybeWhen(
              data: (list) => list.isEmpty
                  ? const SizedBox.shrink()
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Invites', style: AppTheme.semibold(14)),
                        const SizedBox(height: 8),
                        for (final inv in list)
                          _InviteTile(invite: inv, ref: ref),
                        const SizedBox(height: 16),
                      ],
                    ),
              orElse: () => const SizedBox.shrink(),
            ),

            // ── circles ──
            circles.when(
              loading: () => const Padding(
                padding: EdgeInsets.only(top: 60),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (e, _) => _ErrorState(
                message: e is CirclesNotInstalled
                    ? e.toString()
                    : 'Could not load circles.\n$e',
              ),
              data: (list) => list.isEmpty
                  ? const _EmptyState()
                  : Column(
                      children: [
                        for (final c in list) _CircleTile(circle: c),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _createDialog(BuildContext context, WidgetRef ref) async {
    final ctrl = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('New circle'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'e.g. Family, College'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, ctrl.text.trim()),
              child: const Text('Create')),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    try {
      await ref.read(circlesProvider.notifier).create(name: name);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }
}

class _CircleTile extends StatelessWidget {
  const _CircleTile({required this.circle});
  final Circle circle;

  @override
  Widget build(BuildContext context) {
    Color color;
    try {
      color = Color(int.parse(circle.color.replaceFirst('#', '0xFF')));
    } catch (_) {
      color = AppColors.sage;
    }
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.2),
          child: Text(circle.emoji ?? circle.name.characters.first,
              style: TextStyle(color: color)),
        ),
        title: Text(circle.name, style: AppTheme.semibold(15)),
        subtitle: Text(circle.kind, style: AppTheme.medium(12)),
        trailing: const Icon(Icons.chevron_right, color: AppColors.textMuted),
        onTap: () => context.push('/circles/${circle.id}', extra: circle),
      ),
    );
  }
}

class _InviteTile extends StatelessWidget {
  const _InviteTile({required this.invite, required this.ref});
  final CircleInvite invite;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: AppColors.peachSoft,
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text('You\'ve been invited to a circle',
            style: AppTheme.semibold(14)),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextButton(
              onPressed: () async {
                await CirclesService.declineInvite(invite.id);
                ref.invalidate(incomingInvitesProvider);
              },
              child: const Text('Decline'),
            ),
            FilledButton(
              onPressed: () async {
                await CirclesService.acceptInvite(invite);
                ref.invalidate(incomingInvitesProvider);
                await ref.read(circlesProvider.notifier).refresh();
              },
              child: const Text('Accept'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 80),
      child: Column(
        children: [
          const Icon(Icons.group_outlined, size: 48, color: AppColors.textMuted),
          const SizedBox(height: 12),
          Text('No circles yet', style: AppTheme.semibold(16)),
          const SizedBox(height: 4),
          Text('Create one and invite people you trust.',
              style: AppTheme.medium(13), textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 60),
      child: Column(
        children: [
          const Icon(Icons.cloud_off, size: 44, color: AppColors.textMuted),
          const SizedBox(height: 12),
          Text(message, style: AppTheme.medium(13), textAlign: TextAlign.center),
        ],
      ),
    );
  }
}
