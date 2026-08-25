# ORBII — agent instructions

Instructions for any AI coding agent (Claude, Cursor, Copilot) working in this repo.

## Accessibility is a hard constraint, not a polish step

ORBII is a personal-safety app. A user who is blind, low-vision, colour-blind,
elderly, or motor-impaired must be able to fire an SOS, reach their circle, and
call 112, in an emergency, on the worst day of their life. So accessibility is a
precondition for use, not an afterthought.

**When building or changing ANY UI, follow the accessibility rules in A11Y.md:**
https://github.com/fecarrico/A11Y.md/blob/main/docs/en/A11Y.md

- **Compliance profile: Launchpad (A)** — the MVP profile. It relaxes purely
  visual constraints for speed but never sacrifices critical semantic structure,
  keyboard/screen-reader operability, or focus management. Move to **Standard
  (AA)** before a wide public launch.
- The standard lazy-loads its own React Native reference guide on demand; follow
  its native translation layer (React Native), not generic web advice.

### ORBII-specific accessibility priorities (do these especially well)
- **The SOS + Voice SOS + 112 controls** must have clear `accessibilityRole`,
  `accessibilityLabel`, and `accessibilityState`, and be operable by TalkBack.
- **Dynamic emergency state must be ANNOUNCED**, not just shown. The SOS
  countdown, "SOS sent", "helper on the way", and geofence/leave alerts must be
  announced to screen readers (`AccessibilityInfo.announceForAccessibility` /
  `accessibilityLiveRegion="assertive"` for the countdown), because a user who
  can't see the screen still needs to know help is coming.
- **Never ship a "clickable div"** — use a real `Pressable`/`Button` with a
  role, never a bare `View` with `onPress` and no accessibility props.
- **Touch targets ≥ 44×44** (already mostly true; keep it).
- **Don't rely on colour alone** for status (freshness dots, online/offline,
  active/standby): pair every colour with text or an icon.
- **Respect `prefers-reduced-motion`** for the pulses/gradients added recently.

Reference standard adopted from https://github.com/fecarrico/A11Y.md (WCAG 2.2 AA / ADA).
