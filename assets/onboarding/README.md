# Onboarding Orbi artwork

Drop the four onboarding illustrations here as **transparent PNGs** (the Orbi
bee plus its scene props, e.g. speech bubble / phone+map / SOS button), sized
roughly **800–1000px square**:

| File | Screen | Pose in your design |
|------|--------|---------------------|
| `orbi-1.png` | "Your safety. Always with you." | Orbi waving, heart glow |
| `orbi-2.png` | "AI that listens. Protection that acts." | Orbi listening, "I've got your back!" bubble |
| `orbi-3.png` | "Real-time protection. Every step of the way." | Orbi with phone + map trail |
| `orbi-4.png` | "Help when you need it most." | Orbi with the red SOS button |

Once these are in, uncomment the `require()`s in
`src/screens/Onboarding/OnboardingScreen.tsx` (the `ORBI` map) and rebuild —
they'll render in place of the placeholder icon hero.
