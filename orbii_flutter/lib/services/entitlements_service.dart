import 'auth_service.dart';
import 'supabase_service.dart';

/// Reads the user's ORBII Plus entitlement from the `entitlements` table
/// (sql/19). Clients can only READ — the row is written exclusively by the
/// `verify-payment` Edge Function, so premium can't be forged on-device.
class Entitlement {
  const Entitlement({
    required this.planType,
    required this.premiumEnabled,
    required this.status,
    this.purchaseDate,
  });

  final String planType; // 'free' | 'plus'
  final bool premiumEnabled;
  final String status; // 'inactive' | 'active' | ...
  final DateTime? purchaseDate;

  /// Any active paid tier (solo / family / plus) counts as premium.
  bool get isPlus =>
      premiumEnabled && status == 'active' && planType != 'free';

  /// Human label for the active tier.
  String get label {
    switch (planType) {
      case 'family':
        return 'ORBII Family';
      case 'solo':
      case 'plus':
        return 'ORBII Plus';
      default:
        return 'Free';
    }
  }

  static const free = Entitlement(
    planType: 'free',
    premiumEnabled: false,
    status: 'inactive',
  );
}

class EntitlementsService {
  EntitlementsService._();

  static final _c = SupabaseService.client;

  /// Fetch the current user's entitlement (defaults to free).
  static Future<Entitlement> fetch() async {
    final uid = AuthService.currentSession?.user.id;
    if (uid == null) return Entitlement.free;
    try {
      final row = await _c
          .from('entitlements')
          .select('plan_type, premium_enabled, status, purchase_date')
          .eq('user_id', uid)
          .maybeSingle();
      if (row == null) return Entitlement.free;
      return Entitlement(
        planType: (row['plan_type'] ?? 'free') as String,
        premiumEnabled: (row['premium_enabled'] ?? false) as bool,
        status: (row['status'] ?? 'inactive') as String,
        purchaseDate: row['purchase_date'] != null
            ? DateTime.tryParse(row['purchase_date'] as String)
            : null,
      );
    } catch (_) {
      // Table not installed yet (sql/19) or offline → treat as free.
      return Entitlement.free;
    }
  }
}
