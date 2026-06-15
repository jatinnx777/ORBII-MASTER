import 'supabase_service.dart';

/// Circle = a private group of trusted people. Faithful port of RN
/// `circles.ts` — same tables (`circles`, `circle_members`, `circle_invites`),
/// same owner-membership trigger, same RLS. NO social-graph / friends concepts.

class Circle {
  const Circle({
    required this.id,
    required this.ownerId,
    required this.name,
    required this.kind,
    required this.color,
    this.emoji,
    this.isDefault = false,
  });

  final String id;
  final String ownerId;
  final String name;
  final String kind;
  final String color;
  final String? emoji;
  final bool isDefault;

  factory Circle.fromRow(Map<String, dynamic> r) => Circle(
        id: r['id'] as String,
        ownerId: r['owner_id'] as String,
        name: (r['name'] ?? '') as String,
        kind: (r['kind'] ?? 'general') as String,
        color: (r['color'] ?? '#7BC47F') as String,
        emoji: r['emoji'] as String?,
        isDefault: (r['is_default'] ?? false) as bool,
      );
}

class CircleMember {
  const CircleMember({
    required this.userId,
    required this.role,
    this.username,
    this.name,
    this.photoUrl,
  });

  final String userId;
  final String role;
  final String? username;
  final String? name;
  final String? photoUrl;
}

class CircleInvite {
  const CircleInvite({
    required this.id,
    required this.circleId,
    required this.status,
    this.inviteeUsername,
    this.inviteePhone,
    this.token,
  });

  final String id;
  final String circleId;
  final String status;
  final String? inviteeUsername;
  final String? inviteePhone;
  final String? token;

  factory CircleInvite.fromRow(Map<String, dynamic> r) => CircleInvite(
        id: r['id'] as String,
        circleId: r['circle_id'] as String,
        status: (r['status'] ?? 'pending') as String,
        inviteeUsername: r['invitee_username'] as String?,
        inviteePhone: r['invitee_phone'] as String?,
        token: r['token'] as String?,
      );
}

/// Thrown when the circles tables haven't been installed on Supabase yet
/// (sql/09). Surfaced as a friendly setup hint in the UI.
class CirclesNotInstalled implements Exception {
  @override
  String toString() =>
      'Circles tables are not set up. Run sql/09_circles.sql in Supabase.';
}

class CirclesService {
  CirclesService._();

  static final _c = SupabaseService.client;

  static String? get _uid => _c.auth.currentUser?.id;

  static bool _missingTable(Object e) {
    final m = e.toString().toLowerCase();
    return m.contains('42p01') ||
        (m.contains('relation') && m.contains('does not exist')) ||
        m.contains('schema cache');
  }

  static Future<List<Circle>> list() async {
    final uid = _uid;
    if (uid == null) return const [];
    try {
      final memberRows = await _c
          .from('circle_members')
          .select('circle_id')
          .eq('user_id', uid);
      final ids = (memberRows as List)
          .map((r) => (r as Map)['circle_id'] as String)
          .toList();
      if (ids.isEmpty) return const [];
      final rows = await _c
          .from('circles')
          .select()
          .inFilter('id', ids)
          .order('updated_at', ascending: false);
      return (rows as List)
          .map((r) => Circle.fromRow(Map<String, dynamic>.from(r as Map)))
          .toList();
    } catch (e) {
      if (_missingTable(e)) throw CirclesNotInstalled();
      rethrow;
    }
  }

  /// Owner is auto-added as a member via the DB trigger (sql/14).
  static Future<Circle> create({
    required String name,
    String kind = 'general',
    String color = '#7BC47F',
    String? emoji,
    bool isDefault = false,
  }) async {
    final uid = _uid;
    if (uid == null) {
      throw Exception('Sign in with Google to create circles.');
    }
    final trimmed = name.trim();
    if (trimmed.isEmpty) throw Exception('Circle needs a name.');
    try {
      if (isDefault) {
        await _c
            .from('circles')
            .update({'is_default': false})
            .eq('owner_id', uid)
            .eq('is_default', true);
      }
      final row = await _c
          .from('circles')
          .insert({
            'owner_id': uid,
            'name': trimmed,
            'kind': kind,
            'color': color,
            'emoji': emoji,
            'is_default': isDefault,
          })
          .select()
          .single();
      return Circle.fromRow(Map<String, dynamic>.from(row));
    } catch (e) {
      if (_missingTable(e)) throw CirclesNotInstalled();
      rethrow;
    }
  }

  static Future<void> rename(String circleId, String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) throw Exception('Circle needs a name.');
    await _c.from('circles').update({'name': trimmed}).eq('id', circleId);
  }

  static Future<void> remove(String circleId) =>
      _c.from('circles').delete().eq('id', circleId);

  /// Owners can't leave (they delete instead) — enforced by RLS too.
  static Future<void> leave(String circleId) async {
    final uid = _uid;
    if (uid == null) throw Exception('Sign in to leave a circle.');
    await _c
        .from('circle_members')
        .delete()
        .eq('circle_id', circleId)
        .eq('user_id', uid);
  }

  /// Members hydrated with name/photo from `users_public` (NO phone).
  static Future<List<CircleMember>> members(String circleId) async {
    final rows = await _c
        .from('circle_members')
        .select('user_id, role')
        .eq('circle_id', circleId)
        .order('joined_at', ascending: true);
    final base = (rows as List)
        .map((r) => Map<String, dynamic>.from(r as Map))
        .toList();
    if (base.isEmpty) return const [];
    final ids = base.map((r) => r['user_id'] as String).toList();
    final profiles = await _c
        .from('users_public')
        .select('id, username, name, photo_url')
        .inFilter('id', ids);
    final byId = <String, Map<String, dynamic>>{
      for (final p in (profiles as List))
        (p as Map)['id'] as String: Map<String, dynamic>.from(p),
    };
    return base.map((r) {
      final p = byId[r['user_id']];
      return CircleMember(
        userId: r['user_id'] as String,
        role: (r['role'] ?? 'member') as String,
        username: p?['username'] as String?,
        name: p?['name'] as String?,
        photoUrl: p?['photo_url'] as String?,
      );
    }).toList();
  }

  static Future<CircleInvite> inviteByUsername(
      String circleId, String username) async {
    final uid = _uid;
    if (uid == null) throw Exception('Sign in to invite.');
    final trimmed = username.replaceFirst(RegExp(r'^@'), '').trim();
    if (trimmed.isEmpty) throw Exception('Enter a username.');
    final row = await _c
        .from('circle_invites')
        .insert({
          'circle_id': circleId,
          'inviter_id': uid,
          'invitee_username': trimmed,
        })
        .select()
        .single();
    return CircleInvite.fromRow(Map<String, dynamic>.from(row));
  }

  static Future<CircleInvite> inviteByPhone(
      String circleId, String phoneE164) async {
    final uid = _uid;
    if (uid == null) throw Exception('Sign in to invite.');
    final row = await _c
        .from('circle_invites')
        .insert({
          'circle_id': circleId,
          'inviter_id': uid,
          'invitee_phone': phoneE164,
        })
        .select()
        .single();
    return CircleInvite.fromRow(Map<String, dynamic>.from(row));
  }

  /// Pending invites addressed to the current user's username.
  static Future<List<CircleInvite>> incomingInvites() async {
    final uid = _uid;
    if (uid == null) return const [];
    final profile = await _c
        .from('users_public')
        .select('username')
        .eq('id', uid)
        .maybeSingle();
    final username = profile?['username'] as String?;
    if (username == null) return const [];
    final rows = await _c
        .from('circle_invites')
        .select()
        .ilike('invitee_username', username)
        .eq('status', 'pending');
    return (rows as List)
        .map((r) => CircleInvite.fromRow(Map<String, dynamic>.from(r as Map)))
        .toList();
  }

  static Future<void> acceptInvite(CircleInvite invite) async {
    final uid = _uid;
    if (uid == null) throw Exception('Sign in first.');
    try {
      await _c.from('circle_members').insert(
          {'circle_id': invite.circleId, 'user_id': uid, 'role': 'member'});
    } catch (e) {
      if (!e.toString().contains('duplicate')) rethrow;
    }
    await _c.from('circle_invites').update({
      'status': 'accepted',
      'responded_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', invite.id);
  }

  static Future<void> declineInvite(String inviteId) async {
    await _c.from('circle_invites').update({
      'status': 'declined',
      'responded_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', inviteId);
  }
}
