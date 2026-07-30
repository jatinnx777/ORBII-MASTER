# ORBII, End-to-End Encrypted Circle Location (Engineering Spec)

**Status:** Design spec. NOT built yet. This is what to build so that circle
location sharing is end-to-end encrypted (E2EE), meaning ORBII's own servers
store only ciphertext and cannot read a user's coordinates.

**Honest note on sequencing:** ORBII's core privacy promise (voice/audio stays
on-device) already ships. This E2EE feature is an *additional* safeguard for the
location-sharing layer. It is real cryptographic engineering and should be built
carefully, ideally after launch, not rushed before it. Shipping broken crypto is
worse than shipping none, because it creates a false sense of security. Build it
right, test it, then enable it.

---

## Goal

When a user shares live location with their circle during an SOS or Safe
Journey, the coordinates should be readable **only** by the members of that
circle, never by ORBII's servers or database, even if the database is breached
or subpoenaed.

## Threat model

- **In scope:** A compromised/curious ORBII server or database should not be
  able to read location coordinates. A network attacker (TLS already covers this,
  but E2EE adds defense in depth).
- **Out of scope:** A fully compromised member device (if an attacker owns a
  circle member's unlocked phone, they can read what that member can read, this
  is unavoidable in any E2EE system). Metadata (who is in a circle, when an SOS
  fired) is NOT hidden by this design, only the location payload.

## High-level approach

Use public-key cryptography so each recipient can decrypt without ORBII ever
holding a usable key. Recommended primitive: **libsodium** (`crypto_box`,
X25519 + XSalsa20-Poly1305). Available in RN via `react-native-libsodium` and in
Flutter via `sodium_libs`. Do NOT hand-roll crypto; use libsodium's sealed/box APIs.

### Keys

1. On first run, each device generates an **X25519 keypair** in secure storage:
   - Android: Keystore-backed (`EncryptedSharedPreferences` / `flutter_secure_storage`).
   - The **private key never leaves the device.**
2. The **public key** is uploaded to the server and associated with the user.
   Public keys are safe to store in plaintext, that is their purpose.

### Sharing location (sender side)

When user A broadcasts location to circle members B, C, D during an event:
1. Fetch the public keys of B, C, D from the server.
2. For each recipient, encrypt the location payload with `crypto_box_seal`
   (anonymous sealed box) or `crypto_box` (authenticated) to that recipient's
   public key.
3. Upload the **per-recipient ciphertexts** to the server (server stores only
   ciphertext + recipient id + timestamp).

Optimisation for frequent updates: generate a random symmetric **session key**
per SOS event, encrypt each location update with the session key (fast
symmetric `crypto_secretbox`), and encrypt the session key once per recipient
with their public key. This avoids public-key ops on every GPS tick.

### Receiving location (recipient side)

1. Recipient B pulls ciphertext addressed to them (via Supabase realtime /
   polling).
2. Decrypts with their on-device private key.
3. Renders the location on the map. The server never saw plaintext.

## Data model (Supabase)

- `user_keys ( user_id PK, public_key text, updated_at )` , RLS: user can
  upsert their own; anyone in a shared circle can read others' public keys.
- `encrypted_locations ( id, event_id, sender_id, recipient_id, ciphertext,
  created_at )` , RLS: recipient can SELECT rows where `recipient_id = auth.uid()`;
  sender can INSERT. **No column ever holds plaintext lat/lng.**
- Existing plaintext location paths must be removed/disabled for circle sharing
  once E2EE is on, otherwise you leak via the old path.

## Hard parts (plan for these)

1. **Key rotation / new device:** If a user reinstalls or changes phones, they
   generate a new keypair; old ciphertext addressed to the old key is
   undecryptable. Acceptable for ephemeral live location (old fixes expire
   anyway). Just re-fetch keys before each event.
2. **Adding a circle member mid-event:** Re-encrypt the current session key to
   the new member's public key.
3. **Key authenticity (trust):** With sealed boxes, B cannot cryptographically
   verify the sender is A (server could swap a key). For a v1 this is acceptable
   given TLS + auth. For v2, add key fingerprints members can verify, or sign
   public keys.
4. **Backup / recovery:** Losing the private key = cannot decrypt. Fine for
   live location (ephemeral). Do NOT use this exact design for anything that must
   survive device loss without a recovery scheme.
5. **112 / responder path:** Emergency dispatch to strangers/responders cannot
   be E2EE to the whole world (they need to read your location to help). Keep
   E2EE for the *trusted circle* path; the responder path stays server-mediated
   with its own minimal-exposure rules. Be clear in the UI which is which.

## Rollout plan

1. Ship key generation + public-key upload silently in a release (no behaviour change).
2. Build encrypt/decrypt behind a feature flag, test with internal accounts.
3. Migrate circle location sharing to the E2EE path; remove the plaintext path.
4. Add a visible "End-to-end encrypted" indicator in the circle map UI.
5. (v2) Add key-fingerprint verification for stronger trust.

## What to tell users (only after it actually ships)

> During an emergency, your live location is end-to-end encrypted. Only your
> circle can decrypt it. Not even ORBII's servers can read where you are.

Do not put this claim anywhere until steps 1 to 4 are complete and tested.
Until then, the honest line is: "Your location is shared only with your circle
during an event, over an encrypted connection, and is never sold."
