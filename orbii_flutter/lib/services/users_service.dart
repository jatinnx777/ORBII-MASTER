import 'supabase_service.dart';

/// A public directory record (no phone — phone is never returned by directory
/// reads after sql/18). Mirrors RN `PublicUser`.
class PublicUser {
  const PublicUser({
    required this.id,
    required this.username,
    this.name,
    this.photoUrl,
  });

  final String id;
  final String username;
  final String? name;
  final String? photoUrl;

  factory PublicUser.fromRow(Map<String, dynamic> r) => PublicUser(
        id: r['id'] as String,
        username: (r['username'] ?? '') as String,
        name: r['name'] as String?,
        photoUrl: r['photo_url'] as String?,
      );
}

/// Directory lookups against `users_public`. Phone lookups go through the
/// SECURITY DEFINER `find_user_by_phone` RPC — never a direct phone query
/// (see sql/18). Mirrors RN `users-public.ts`.
class UsersService {
  UsersService._();

  static final _c = SupabaseService.client;

  /// Exact-match phone lookup for the circle-invite flow. Returns null if no
  /// registered user has that number. NEVER exposes the phone column.
  static Future<PublicUser?> findByPhone(String phoneE164,
      {String? excludeUid}) async {
    if (!phoneE164.startsWith('+')) return null;
    final data = await _c.rpc('find_user_by_phone', params: {
      'p_phone': phoneE164,
      'p_exclude': excludeUid,
    });
    final list = (data as List?) ?? const [];
    if (list.isEmpty) return null;
    return PublicUser.fromRow(Map<String, dynamic>.from(list.first as Map));
  }

  /// Username/name substring search, capped at 10, excluding the caller.
  static Future<List<PublicUser>> search(String query,
      {required String excludeUid}) async {
    final q = query.trim().toLowerCase();
    if (q.length < 2) return const [];
    final escaped = q.replaceAllMapped(RegExp(r'[%_]'), (m) => '\\${m[0]}');
    final rows = await _c
        .from('users_public')
        .select('id, username, name, photo_url')
        .or('username.ilike.%$escaped%,name.ilike.%$escaped%')
        .neq('id', excludeUid)
        .order('username')
        .limit(10);
    return (rows as List)
        .map((r) => PublicUser.fromRow(Map<String, dynamic>.from(r as Map)))
        .toList();
  }

  static Future<PublicUser?> byUsername(String username) async {
    final row = await _c
        .from('users_public')
        .select('id, username, name, photo_url')
        .eq('username', username)
        .maybeSingle();
    if (row == null) return null;
    return PublicUser.fromRow(Map<String, dynamic>.from(row));
  }
}
