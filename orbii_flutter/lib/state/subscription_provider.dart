import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/entitlements_service.dart';

/// ORBII Plus entitlement state. Loaded from the `entitlements` table on
/// startup and refreshed after a successful purchase, so the whole UI (premium
/// badge, gated features, Protection Strength) reacts instantly.
class SubscriptionController extends AsyncNotifier<Entitlement> {
  @override
  Future<Entitlement> build() => EntitlementsService.fetch();

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(EntitlementsService.fetch);
  }
}

final subscriptionProvider =
    AsyncNotifierProvider<SubscriptionController, Entitlement>(
  SubscriptionController.new,
);

/// Convenience: is the user on ORBII Plus right now?
final isPremiumProvider = Provider<bool>((ref) {
  return ref.watch(subscriptionProvider).maybeWhen(
        data: (e) => e.isPlus,
        orElse: () => false,
      );
});
