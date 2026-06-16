import 'dart:ui';
import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';

/// Glassmorphism popup shell — a frosted, blurred card with a soft border.
/// Use [OrbiiDialog.show] for custom content, or [showOrbiiPrompt] for a
/// single-field text prompt. Keeps every ORBII popup consistent + lively.
class OrbiiDialog extends StatelessWidget {
  const OrbiiDialog({super.key, required this.child});

  final Widget child;

  static Future<T?> show<T>(BuildContext context, Widget child) {
    return showGeneralDialog<T>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'dismiss',
      barrierColor: const Color(0x66201E1C),
      transitionDuration: const Duration(milliseconds: 220),
      pageBuilder: (ctx, anim, secondary) => OrbiiDialog(child: child),
      transitionBuilder: (ctx, anim, secondary, dialog) {
        final curved = CurvedAnimation(parent: anim, curve: Curves.easeOutBack);
        return FadeTransition(
          opacity: anim,
          child: ScaleTransition(
            scale: Tween(begin: 0.92, end: 1.0).animate(curved),
            child: dialog,
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
            child: Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                color: const Color(0xF2FAF8F6), // frosted surface
                borderRadius: BorderRadius.circular(28),
                border: Border.all(color: const Color(0x99FFFFFF), width: 1),
                boxShadow: const [
                  BoxShadow(color: Color(0x26000000), blurRadius: 30, offset: Offset(0, 12)),
                ],
              ),
              child: Material(
                color: Colors.transparent,
                child: child,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Single-field glassmorphism text prompt. Returns the trimmed input, or null
/// if cancelled.
Future<String?> showOrbiiPrompt(
  BuildContext context, {
  required String title,
  String? subtitle,
  String hint = '',
  String initial = '',
  String confirmLabel = 'Save',
  IconData? icon,
  TextInputType keyboard = TextInputType.text,
}) {
  final ctrl = TextEditingController(text: initial);
  return OrbiiDialog.show<String>(
    context,
    Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (icon != null) ...[
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.peachSoft,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(icon, color: AppColors.peachDeep),
          ),
          const SizedBox(height: 14),
        ],
        Text(title, style: AppTheme.bold(19)),
        if (subtitle != null) ...[
          const SizedBox(height: 4),
          Text(subtitle, style: AppTheme.medium(13)),
        ],
        const SizedBox(height: 16),
        TextField(
          controller: ctrl,
          autofocus: true,
          keyboardType: keyboard,
          style: AppTheme.medium(15, color: AppColors.textPrimary),
          decoration: InputDecoration(
            hintText: hint,
            filled: true,
            fillColor: AppColors.cream,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide.none,
            ),
          ),
        ),
        const SizedBox(height: 18),
        Row(
          children: [
            Expanded(
              child: TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text('Cancel',
                    style: AppTheme.semibold(14, color: AppColors.textSecondary)),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.coral,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: () => Navigator.pop(context, ctrl.text.trim()),
                child: Text(confirmLabel),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}
