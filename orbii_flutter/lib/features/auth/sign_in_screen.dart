import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/colors.dart';
import '../../services/auth_service.dart';

/// Sign-in gate. Phone OTP is the primary, most reliable path (no OAuth
/// redirect round-trip); Google + Apple are offered as one-tap alternatives.
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

  String _toE164(String input) {
    var s = input.trim().replaceAll(RegExp(r'[\s\-()]'), '');
    if (s.startsWith('+')) return s;
    s = s.replaceFirst(RegExp(r'^0+'), '');
    if (s.length == 10) return '+91$s';
    return '+$s';
  }

  Future<void> _sendOtp() => _run(() async {
        final phone = _toE164(_phoneCtrl.text);
        if (phone.length < 8) throw 'Enter a valid phone number.';
        await AuthService.sendPhoneOtp(phone);
        if (mounted) setState(() => _otpSent = true);
      });

  Future<void> _verify() => _run(() async {
        await AuthService.verifyPhoneOtp(
          phoneE164: _toE164(_phoneCtrl.text),
          token: _otpCtrl.text.trim(),
        );
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ── Brand ──
                Center(
                  child: Container(
                    width: 84,
                    height: 84,
                    decoration: BoxDecoration(
                      color: AppColors.goldSoft,
                      borderRadius: BorderRadius.circular(26),
                      boxShadow: const [
                        BoxShadow(color: Color(0x22000000), blurRadius: 18, offset: Offset(0, 8)),
                      ],
                    ),
                    child: const Icon(Icons.shield_rounded,
                        size: 42, color: AppColors.goldDeep),
                  ),
                ),
                const SizedBox(height: 22),
                Text('ORBII',
                    textAlign: TextAlign.center,
                    style: AppTheme.bold(34, color: AppColors.coral)),
                const SizedBox(height: 6),
                Text('Your safety, always within reach.',
                    textAlign: TextAlign.center, style: AppTheme.medium(14)),
                const SizedBox(height: 36),

                // ── Phone (primary) ──
                _Field(
                  controller: _phoneCtrl,
                  hint: 'Phone number',
                  icon: Icons.phone_outlined,
                  keyboard: TextInputType.phone,
                  enabled: !_otpSent && !_busy,
                ),
                if (_otpSent) ...[
                  const SizedBox(height: 12),
                  _Field(
                    controller: _otpCtrl,
                    hint: '6-digit code',
                    icon: Icons.lock_outline,
                    keyboard: TextInputType.number,
                    enabled: !_busy,
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.coral,
                    minimumSize: const Size.fromHeight(54),
                  ),
                  onPressed: _busy ? null : (_otpSent ? _verify : _sendOtp),
                  child: _busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppColors.textInverse))
                      : Text(_otpSent ? 'Verify & continue' : 'Continue with phone'),
                ),
                if (_otpSent)
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => setState(() {
                              _otpSent = false;
                              _otpCtrl.clear();
                            }),
                    child: const Text('Use a different number'),
                  ),

                const SizedBox(height: 18),
                Row(children: [
                  const Expanded(child: Divider(color: AppColors.creamDeep)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text('or', style: AppTheme.medium(12)),
                  ),
                  const Expanded(child: Divider(color: AppColors.creamDeep)),
                ]),
                const SizedBox(height: 18),

                // ── Social ──
                _SocialButton(
                  icon: Icons.g_mobiledata_rounded,
                  iconSize: 30,
                  label: 'Continue with Google',
                  onTap: _busy ? null : () => _run(AuthService.signInWithGoogle),
                ),
                const SizedBox(height: 12),
                _SocialButton(
                  icon: Icons.apple,
                  iconSize: 24,
                  label: 'Continue with Apple',
                  dark: true,
                  onTap: _busy ? null : () => _run(AuthService.signInWithApple),
                ),

                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(_error!,
                      textAlign: TextAlign.center,
                      style: AppTheme.medium(12, color: AppColors.coralDeep)),
                ],
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.controller,
    required this.hint,
    required this.icon,
    required this.keyboard,
    required this.enabled,
  });

  final TextEditingController controller;
  final String hint;
  final IconData icon;
  final TextInputType keyboard;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: keyboard,
      enabled: enabled,
      style: AppTheme.medium(15, color: AppColors.textPrimary),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: AppTheme.medium(14, color: AppColors.textMuted),
        prefixIcon: Icon(icon, color: AppColors.textMuted, size: 20),
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}

class _SocialButton extends StatelessWidget {
  const _SocialButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.iconSize = 24,
    this.dark = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final double iconSize;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final fg = dark ? AppColors.textInverse : AppColors.textPrimary;
    return Material(
      color: dark ? AppColors.textPrimary : AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          height: 54,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: dark ? null : Border.all(color: AppColors.creamDeep),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: fg, size: iconSize),
              const SizedBox(width: 10),
              Text(label, style: AppTheme.semibold(15, color: fg)),
            ],
          ),
        ),
      ),
    );
  }
}
