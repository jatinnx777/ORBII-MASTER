# ORBII Offline Mesh — Engineering Spec (v1)

Status: design. Nothing here is built yet. This is the blueprint for the offline
SOS relay and the features that ride on the same mesh.

## Goal
When a user has no cellular/internet, their SOS still gets out by hopping
phone-to-phone over short-range radios until it reaches an ORBII phone that DOES
have signal, which bridges it to the server. The server then alerts the circle
normally. The mesh's job is to escape the dead zone, not to span the whole
distance to a contact.

## Non-goals (v1)
- Not a general stranger chat (harassment vector on a safety app).
- Not a public "who is nearby by name" list (stalking vector).
- Not iOS first (iOS background BLE + no Wi-Fi Aware; Android first).
- No "unhackable"/"immune" claims anywhere. The property is: relayed payloads
  are sealed end-to-end so relays cannot read them.

## Radio strategy (adaptive, works on any phone)
Every phone speaks the **universal floor** so nobody is invisible; capable
phones add **boost layers** on top.

- Floor (all phones): standard BLE 1M PHY — advertise + scan. ~10-30m/hop.
- Boost A (capable): BLE Coded PHY via extended advertising. ~100-150m/hop.
- Boost B (capable): Wi-Fi Aware / Google Nearby Connections. ~80-100m/hop,
  better through walls, higher bandwidth.

Detect at runtime: `isLeCodedPhySupported`, `isLeExtendedAdvertisingSupported`,
`PackageManager.FEATURE_WIFI_AWARE`, Nearby Connections availability. Capable
phones dual-broadcast (floor + boost) so a budget phone still hears them.

## Packet format (binary, compact)
```
[ ver:1 | type:1 | ttl:1 | msgId:4 | sealed_payload:N ]
```
- `msgId` (4 bytes): random per message, used for dedup + as the deep-link id.
- `sealed_payload`: libsodium `crypto_box_seal` to the ORBII server (and/or
  circle) public key. Relays see only ciphertext. Contains: victim id,
  lat/lng, timestamp, flags. Realistic size ~60-90 bytes (needs extended
  advertising or a data channel, not the 31-byte legacy advert).

## Crypto (relays are blind couriers)
- `crypto_box_seal` (X25519 + XSalsa20-Poly1305): anonymous public-key
  encryption to the recipient. Only the ORBII server / circle private key opens
  it. NO separate HMAC (Poly1305 already authenticates — the earlier doc was
  redundant here).
- Sender rotates an ephemeral anonymous id per SOS. No persistent identifier is
  ever broadcast. Presence beacons (if any) also rotate and are opt-in.

## Managed flooding (no broadcast storm)
1. Receive packet. If `msgId` in the seen-cache (LRU, ~1000 entries, 5-min
   window) → drop.
2. Else add to cache. `ttl -= 1`. If `ttl <= 0` → deliver locally / bridge,
   stop.
3. Else re-broadcast for a short window (~15s) with jitter (10-220ms) to hand
   it to the next hop. Origin TTL 5.

## The bridge (the actual lifesaver)
Any relay that currently HAS internet POSTs the sealed payload to a Supabase
edge function (`mesh-bridge`), which decrypts with the server key and fires the
normal SOS dispatch to the victim's circle. So one hop to a connected phone =
global reach.

## Privacy + safety rules (non-negotiable)
- Broadcast ONLY during an active SOS (or disaster mode). No always-on "I'm
  here" beacon → protects battery AND prevents stalker tracking.
- Rotating anonymous ids only.
- Sealed payloads; relays never see location.
- Presence/"help is near" features are anonymous counts or opt-in helper-only.

## Battery
- RSSI-gated, duty-cycled scanning. Foreground service only while armed
  (reuse the Voice SOS foreground-service + battery-exemption flow). Not a
  24/7 relay on every phone.

## Android surface
- `OrbiiMeshService` (Kotlin foreground service): advertiser + scanner + relay.
- `OrbiiMeshModule` (RN bridge): `getCapabilities()`, `armSosRelay(sealed)`,
  `disarm()`, events for received/bridged.
- Native register in `MainApplication` (same pattern as VoiceGuard/HelperOverlay).
- libsodium via `com.goterl:lazysodium-android`.

## Phases
- **P0 Capability probe (days):** ship `getCapabilities()` + anonymous report,
  so we learn what % of real ORBII phones support Coded PHY / Wi-Fi Aware /
  Nearby. Build the rest on data, not guesses.
- **P1 Universal BLE floor:** offline SOS relay + `mesh-bridge` edge function.
  The core value. Works on every phone at ~30m hops.
- **P2 Range boosts:** Coded PHY + Wi-Fi Aware / Nearby, feature-gated, floor
  kept for interop.
- **P3 Disaster mode + offline circle messaging (Plus):** need-help / I'm-safe
  beacons, offline location share, store-and-forward circle text.
- **P4 Hardening:** battery tuning, OEM exemptions, security review, abuse
  limits, iOS exploration.

## Honesty guardrails for marketing
- Say "if any ORBII user is near you, your SOS can get through without signal",
  never "guaranteed 500m offline".
- Mesh reach = user density × per-hop range. Zero neighbours = no mesh; only
  cell/satellite covers the empty-road case. Never imply otherwise.
