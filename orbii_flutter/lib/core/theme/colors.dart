import 'package:flutter/material.dart';

/// ORBII — Warm Greige design system (ported 1:1 from the RN `colors.ts`).
///
/// Calm, premium, Apple-quality warmth. One soft greige canvas, four feeling
/// accents, each with a `*Soft` tint for badges/fills.
class AppColors {
  AppColors._();

  // ── Canvas ────────────────────────────────────────────────
  static const cream = Color(0xFFF2EEEB); // app background (warm greige)
  static const creamDeep = Color(0xFFEAE4DF); // pressed / alt surface
  static const surface = Color(0xFFFAF8F6); // cards
  static const surfaceAlt = Color(0xFFFFFFFF); // pure-white insets

  // ── Gold (primary accent / CTA) ──────────────────────────
  static const peach = Color(0xFFFFD77A);
  static const peachDeep = Color(0xFFE8B84F);
  static const peachSoft = Color(0xFFFBEFD2);

  // ── Sage (success / safe / all-clear) ────────────────────
  static const sage = Color(0xFF7BC47F);
  static const sageDeep = Color(0xFF5BA85F);
  static const sageSoft = Color(0xFFE4F1E5);

  // ── Coral (SOS / alarm) ──────────────────────────────────
  static const coral = Color(0xFFFF6B57);
  static const coralDeep = Color(0xFFE8553F);
  static const coralSoft = Color(0xFFFFE3DD);

  // ── Lavender (Voice SOS / trusted network) ───────────────
  static const lavender = Color(0xFF8B7CF8);
  static const lavenderDeep = Color(0xFF6F5DE0);
  static const lavenderSoft = Color(0xFFECE8FE);

  // ── Gold (mascot / shield) — same family as primary ──────
  static const gold = Color(0xFFFFD77A);
  static const goldDeep = Color(0xFFE8B84F);
  static const goldSoft = Color(0xFFFBEFD2);

  // ── Text ─────────────────────────────────────────────────
  static const textPrimary = Color(0xFF2D2D2D);
  static const textSecondary = Color(0xFF8A837D);
  static const textMuted = Color(0xFFB3ABA4);
  static const textInverse = Color(0xFFFFFFFF);

  // ── Lines (soft, never dark) ─────────────────────────────
  static const border = Color(0x0D2D2D2D); // rgba(45,45,45,0.05)
  static const divider = Color(0x0A2D2D2D); // rgba(45,45,45,0.04)
  static const overlay = Color(0x73282624); // rgba(40,38,36,0.45)

  // ── Semantic ─────────────────────────────────────────────
  static const success = sage;
  static const warning = peach;
  static const error = coral;
}
