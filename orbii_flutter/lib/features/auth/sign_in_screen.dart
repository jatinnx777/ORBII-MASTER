import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/auth_service.dart';

/// Sign-in gate — Google OAuth + phone OTP, matching the RN Auth screen's two
/// paths. Profile completion (username/photo) is handled post-auth in Phase 2.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  bool _otpSent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _google() => _run(AuthService.signInWithGoogle);

  Future<void> _sendOtp() => _run(() async {
        final phone = _phoneCtrl.text.trim();
        if (!phone.startsWith('+')) {
          throw 'Enter your number in international format, e.g. +9198…';
        }
        await AuthService.sendPhoneOtp(phone);
        if (mounted) setState(() => _otpSent = true);
      });

  Future<void> _verify() => _run(() async {
        await AuthService.verifyPhoneOtp(
          phoneE164: _phoneCtrl.text.trim(),
          token: _otpCtrl.text.trim(),
        );
        // On success the auth stream fires → router redirects to Home.
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 76,
                    height: 76,
                    decoration: BoxDecoration(
                      color: AppColors.goldSoft,
                      borderRadius: BorderRadius.circular(24),
                    ),
                    child: const Icon(Icons.shield_outlined,
                        size: 38, color: AppColors.goldDeep),
                  ),
                ),
                const SizedBox(height: 20),
                Text('ORBII',
                    textAlign: TextAlign.center,
                    style: AppTheme.bold(30, color: AppColors.coral)),
                const SizedBox(height: 4),
                Text('Your safety, always within reach.',
                    textAlign: TextAlign.center,
                    style: AppTheme.medium(14)),
                const SizedBox(height: 32),

                // ── Google ──
                _OutlinedAction(
                  icon: Icons.g_mobiledata,
                  label: 'Continue with Google',
                  onTap: _busy ? null : _google,
                ),
                const SizedBox(height: 20),
                Row(children: [
                  const Expanded(child: Divider(color: AppColors.creamDeep)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text('or', style: AppTheme.medium(12)),
                  ),
                  const Expanded(child: Divider(color: AppColors.creamDeep)),
                ]),
                const SizedBox(height: 20),

                // ── Phone OTP ──
                TextField(
                  controller: _phoneCtrl,
                  keyboardType: TextInputType.phone,
                  enabled: !_otpSent,
                  decoration: _fieldDecoration('Phone number (+91…)'),
                ),
                if (_otpSent) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _otpCtrl,
                    keyboardType: TextInputType.number,
                    decoration: _fieldDecoration('6-digit code'),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy
                      ? null
                      : _otpSent
                          ? _verify
                          : _sendOtp,
                  child: _busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppColors.textInverse),
                        )
                      : Text(_otpSent ? 'Verify & continue' : 'Send code'),
                ),

                if (_error != null) ...[
                  const SizedBox(height: 14),
                  Text(_error!,
                      textAlign: TextAlign.center,
                      style: AppTheme.medium(12, color: AppColors.coralDeep)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration(String hint) => InputDecoration(
        hintText: hint,
        hintStyle: AppTheme.medium(14, color: AppColors.textMuted),
        filled: true,
        fillColor: AppColors.surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
      );
}

class _OutlinedAction extends StatelessWidget {
  const _OutlinedAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.creamDeep),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: AppColors.textPrimary, size: 26),
            const SizedBox(width: 8),
            Text(label, style: AppTheme.semibold(15)),
          ],
        ),
      ),
    );
  }
}
