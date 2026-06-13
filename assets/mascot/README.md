# ORBII Mascot Art

Drop the rendered 3D guardian-egg PNGs here. `src/components/common/Mascot.tsx`
will use them via `require('../../assets/mascot/<name>.png')`; until they exist
it draws a flat placeholder egg.

## Required files (transparent background PNG)

| File | Pose (from the mockups) | Used on |
|---|---|---|
| `neutral.png` | calm smiling egg, facing forward | Splash, Home |
| `wave.png` | waving on a cloud | Welcome / Login |
| `shield.png` | holding the SOS shield | Onboarding "Help when you need it" |
| `headset.png` | wearing a headset | Secret Phrase setup |
| `celebrate.png` | arms up, confetti | "You're Protected" success |
| `peek.png` | peeking from behind the sheet | Home bottom-sheet corner |

## Specs
- Transparent background, square-ish canvas, centered.
- Export at **3x** (e.g. ~480–600px tall) for crisp rendering on all phones.
- Keep the warm yellow/gold body (#EFC062-ish) consistent across poses.

Once these are in place, no code changes are needed — each screen already
references the correct pose name.
