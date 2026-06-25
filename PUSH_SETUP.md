# Push notifications — one-time setup

The SOS push fan-out (circle + contacts alerted even with their app closed) is
fully coded. It stays **dormant** until Android FCM is configured + the edge
function is deployed. Do these once:

## 1. Firebase (FCM) — required for Android push
1. Create a free Firebase project at https://console.firebase.google.com.
2. Add an Android app with package name **`com.orbii.app`**.
3. Download **`google-services.json`** → put it in **`android/app/google-services.json`**.
4. Wire the Google Services Gradle plugin:
   - `android/build.gradle` (project): add `classpath 'com.google.gms:google-services:4.4.2'` to `buildscript.dependencies`.
   - `android/app/build.gradle` (bottom): add `apply plugin: 'com.google.gms.google-services'`.
5. Give Expo's push service your FCM v1 credentials so it can deliver:
   `eas credentials` → Android → Push Notifications (FCM V1) → upload the
   service-account JSON from Firebase (Project settings → Service accounts →
   Generate new private key).

> Without google-services.json the app build still works — `registerPushToken`
> just no-ops. Push only starts flowing after the above.

## 2. Deploy the edge function
```
supabase functions deploy notify-sos
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — no
extra secrets needed.

## 3. Run the SQL
Apply **`sql/20_push_tokens.sql`** in the Supabase SQL editor (creates the
`push_tokens` table + RLS).

## Test
Sign in on two phones, add each other to a circle, fire an SOS on one — the
other should get a push even with the app closed. Check the function logs in
the Supabase dashboard if nothing arrives.
