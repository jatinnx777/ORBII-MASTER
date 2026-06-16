import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/sos_history_service.dart';

final _historyProvider = FutureProvider.autoDispose<List<SosHistoryItem>>(
  (ref) => SosHistoryService.list(),
);

/// SOS history — the user's own past events (owner-scoped by RLS).
class HistoryScreen extends ConsumerWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(_historyProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('SOS History')),
      body: history.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Could not load history.\n$e')),
        data: (items) => items.isEmpty
            ? Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.history,
                        size: 48, color: AppColors.textMuted),
                    const SizedBox(height: 12),
                    Text('No SOS events yet', style: AppTheme.semibold(16)),
                  ],
                ),
              )
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                itemBuilder: (_, i) {
                  final it = items[i];
                  final resolved = it.status == 'resolved';
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor:
                            resolved ? AppColors.sageSoft : AppColors.coralSoft,
                        child: Icon(
                          resolved ? Icons.check : Icons.sos,
                          color: resolved
                              ? AppColors.sageDeep
                              : AppColors.coralDeep,
                          size: 18,
                        ),
                      ),
                      title: Text(it.address ?? 'SOS event',
                          style: AppTheme.semibold(14)),
                      subtitle: Text(
                        '${it.status} · ${_fmt(it.createdAt)}',
                        style: AppTheme.medium(12),
                      ),
                    ),
                  );
                },
              ),
      ),
    );
  }

  String _fmt(DateTime d) =>
      '${d.day}/${d.month}/${d.year} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
}
