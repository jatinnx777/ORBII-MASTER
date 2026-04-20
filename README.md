# ORBII

Emergency response platform — dispatches verified civilian helpers within 2 minutes.

See [ORBII_PROJECT_BRIEF.md](ORBII_PROJECT_BRIEF.md) for full product spec.

## Run locally

```bash
npm install
npm start
```

Scan the QR code from the Expo CLI with the **Expo Go** app on your phone (install from Play Store / App Store).

## Authentication — dev mode

Phone auth currently runs in dev-mock mode. Details:

- Enter any valid 10-digit Indian mobile number (starts with 6–9).
- OTP is always `123456`.
- Flip `DEV_AUTH_MODE` to `false` in [src/services/auth.ts](src/services/auth.ts) when you're ready to wire real Firebase phone auth. For Expo, that requires a dev-client build with `@react-native-firebase/auth`.

## Project structure

```
App.tsx              — entry point, font loading, Redux provider, navigator switch
src/
  theme/             — colors, typography, spacing design tokens
  components/common/ — Button, Input, ScreenContainer
  navigation/        — Auth + App stack navigators
  screens/Auth/      — Login, OTP, ProfileSetup
  services/          — auth + firebase config
  redux/             — store + userSlice
  types/             — shared TS types
  utils/             — validation helpers
```

i improved the sos service in ORBII
