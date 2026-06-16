import 'auth_service.dart';
import 'supabase_service.dart';

/// A past SOS event for the History screen.
class SosHistoryItem {
  const SosHistoryItem({
    required this.id,
    required this.status,
    required this.createdAt,
    this.address,
  });

  final String id;
  final String status; // active | resolved | cancelled
  final DateTime createdAt;
  final String? address;
}

/// Reads the signed-in user's own SOS history from `sos_events` (owner-scoped
/// by RLS). Port of RN `sos-history.ts`.
class SosHistoryService {
  SosHistoryService._();

  static final _c = SupabaseService.client;

  static Future<List<SosHistoryItem>> list() async {
    final uid = AuthService.currentSession?.user.id;
    if (uid == null) return const [];
    try {
      final rows = await _c
          .from('sos_events')
          .select('id, status, address, created_at')
          .eq('user_id', uid)
          .order('created_at', ascending: false)
          .limit(50);
      return (rows as List).map((raw) {
        final r = Map<String, dynamic>.from(raw as Map);
        return SosHistoryItem(
          id: r['id'] as String,
          status: (r['status'] ?? 'resolved') as String,
          address: r['address'] as String?,
          createdAt: DateTime.tryParse('${r['created_at']}')?.toLocal() ??
              DateTime.now(),
        );
      }).toList();
    } catch (_) {
      return const [];
    }
  }
}
