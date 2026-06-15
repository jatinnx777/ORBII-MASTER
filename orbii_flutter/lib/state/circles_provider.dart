import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/circles_service.dart';

/// Lists the circles the signed-in user belongs to. Refreshable after
/// create/leave/delete. Replaces RN `circlesSlice`.
class CirclesController extends AsyncNotifier<List<Circle>> {
  @override
  Future<List<Circle>> build() => CirclesService.list();

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(CirclesService.list);
  }

  Future<Circle> create({
    required String name,
    String kind = 'general',
    String? emoji,
  }) async {
    final circle =
        await CirclesService.create(name: name, kind: kind, emoji: emoji);
    await refresh();
    return circle;
  }

  Future<void> leave(String circleId) async {
    await CirclesService.leave(circleId);
    await refresh();
  }

  Future<void> remove(String circleId) async {
    await CirclesService.remove(circleId);
    await refresh();
  }
}

final circlesProvider =
    AsyncNotifierProvider<CirclesController, List<Circle>>(
  CirclesController.new,
);

/// Members of a single circle (hydrated with name/photo from users_public).
final circleMembersProvider =
    FutureProvider.family<List<CircleMember>, String>(
  (ref, circleId) => CirclesService.members(circleId),
);

/// Pending invites addressed to the current user.
final incomingInvitesProvider = FutureProvider<List<CircleInvite>>(
  (ref) => CirclesService.incomingInvites(),
);
