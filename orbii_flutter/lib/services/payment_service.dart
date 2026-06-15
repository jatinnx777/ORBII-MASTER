import 'dart:async';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import 'supabase_service.dart';

/// Outcome of a checkout attempt.
enum PaymentStatus { success, failed, cancelled }

class PaymentResult {
  const PaymentResult(this.status, [this.message]);
  final PaymentStatus status;
  final String? message;

  bool get isSuccess => status == PaymentStatus.success;
}

/// Razorpay TEST-mode checkout for ORBII Plus. The secret key is NEVER here:
///   1. `create-order` Edge Function makes the order server-side (secret stays
///      in function env) and returns orderId + publishable keyId.
///   2. Checkout opens with that order.
///   3. On success we DON'T trust the client — `verify-payment` re-checks the
///      HMAC signature server-side and grants the entitlement.
class PaymentService {
  PaymentService() {
    _razorpay
      ..on(Razorpay.EVENT_PAYMENT_SUCCESS, _onSuccess)
      ..on(Razorpay.EVENT_PAYMENT_ERROR, _onError)
      ..on(Razorpay.EVENT_EXTERNAL_WALLET, _onWallet);
  }

  final _razorpay = Razorpay();
  Completer<PaymentResult>? _pending;
  String? _orderId;
  String _plan = 'plus';

  static final _fn = SupabaseService.client.functions;

  /// Run the full ORBII Plus purchase. Resolves when the user completes,
  /// cancels, or the payment fails.
  Future<PaymentResult> purchasePlus() async {
    final completer = Completer<PaymentResult>();
    _pending = completer;
    try {
      final res = await _fn.invoke('create-order', body: {'plan': 'plus'});
      final data = res.data as Map?;
      final orderId = data?['orderId'] as String?;
      if (orderId == null) {
        _resolve(const PaymentResult(
            PaymentStatus.failed, 'Could not start checkout.'));
        return completer.future;
      }
      _orderId = orderId;
      _plan = 'plus';
      final keyId =
          (data?['keyId'] as String?) ?? dotenv.env['RAZORPAY_KEY_ID'] ?? '';
      _razorpay.open({
        'key': keyId,
        'order_id': orderId,
        'amount': data?['amount'],
        'currency': data?['currency'] ?? 'INR',
        'name': 'ORBII Plus',
        'description': 'Enhanced protection',
        'theme': {'color': '#FF6B57'},
      });
    } catch (e) {
      _resolve(PaymentResult(PaymentStatus.failed, '$e'));
    }
    return completer.future;
  }

  Future<void> _onSuccess(PaymentSuccessResponse r) async {
    // Server-side verification — the client callback alone never grants Plus.
    try {
      final res = await _fn.invoke('verify-payment', body: {
        'orderId': _orderId,
        'paymentId': r.paymentId,
        'signature': r.signature,
        'plan': _plan,
      });
      final ok = (res.data as Map?)?['premium'] == true;
      _resolve(ok
          ? const PaymentResult(PaymentStatus.success)
          : const PaymentResult(
              PaymentStatus.failed, 'Payment could not be verified.'));
    } catch (e) {
      _resolve(PaymentResult(PaymentStatus.failed, 'Verification error: $e'));
    }
  }

  void _onError(PaymentFailureResponse r) {
    final cancelled = r.code == Razorpay.PAYMENT_CANCELLED;
    _resolve(cancelled
        ? const PaymentResult(PaymentStatus.cancelled)
        : PaymentResult(PaymentStatus.failed, r.message ?? 'Payment failed.'));
  }

  void _onWallet(ExternalWalletResponse r) {/* not used in test flow */}

  void _resolve(PaymentResult result) {
    if (_pending != null && !_pending!.isCompleted) {
      _pending!.complete(result);
    }
  }

  void dispose() => _razorpay.clear();
}
