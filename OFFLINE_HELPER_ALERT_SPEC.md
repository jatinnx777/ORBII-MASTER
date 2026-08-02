# ORBII Offline Helper Alert — Spec (v1)

Status: design. The feature that reaches nearby helpers over Bluetooth when
cellular, data, AND the internet bridge are ALL down. Zero internet.

Founder decision (Jatin, Aug 2026): when everything is down, saving a life comes
first. Build a direct-to-helper offline alert. But build the SAFE form of it
(below), because a careless version can help the very person she is fleeing.

## Why
If there is no signal and no phone nearby with internet to bridge, the only
people who can reach her are ORBII helpers already within Bluetooth range
(~30-150m). This lets her SOS reach those nearby helpers directly over
Bluetooth, with no internet at all, so they physically come.

## The one real danger, and how we handle it
This is a women's safety app; the attacker is often nearby and known. Bluetooth
is short range, so ONLY phones within ~100m receive the broadcast, any nearby
helper AND any nearby bad actor. A distant stalker cannot intercept it. The
residual risk: a hostile phone WITHIN range gets a precise GPS pin and closes in.

Rules (non-negotiable):
1. **Never broadcast raw GPS in the clear.** Reach helpers by PROXIMITY, not
   coordinates: broadcast "someone right near you needs help" and let the
   helper home in using Bluetooth signal strength (warmer/colder). A nearby
   attacker already knows she is near, so they gain no new precise pin.
2. **Exact location, if ever shared offline, is sealed to a VERIFIED-helper
   key** (only verified helpers hold the private key). Best-effort (a key can
   leak); short range bounds the abuse. Unverified nearby users get the ping +
   homing only, never coordinates.
3. **Emergency-override only.** Direct-to-helper mode activates ONLY when the
   phone has no connectivity at all (data off AND no bridge reachable), never
   in normal use.
4. **Victim opt-in** in settings; she can turn offline-helper broadcast off.

## Premium gating
Helper dispatch is Premium-only (free users' SOS reaches only their circle, see
[[project_premium_helper_gate]]). So this **offline helper alert is a Premium
feature**. A free user's offline SOS still goes out (SMS to contacts + the
Bluetooth bridge to the server for their circle), it just does not tap the
verified-helper network. Premium is what unlocks nearby helpers responding.

## On hiding the location (Jatin's ask, confirmed)
Yes, we can hide it, and Phase 1 does exactly that. **Phase 1 broadcasts NO
coordinates at all**, only a "someone right near you needs help" ping, and the
helper homes in by Bluetooth signal strength. So the life-saving reach happens
with the exact location never leaving her phone. Coordinates only enter the
picture in Phase 2, and only sealed to a verified-helper key. Either way she
can opt out.

## Target flow
1. SOS fires. No internet, no bridge reachable.
2. Phone broadcasts over Bluetooth:
   - a. an SOS PING ("someone here needs help"), NO location;
   - b. (P2) the location sealed to the current verified-helper public key.
3. Nearby helper phones (already in mesh LISTEN mode) catch the ping → show a
   full-screen "someone within ~100m needs help" alert with a warmer/colder
   signal-strength meter.
4. Helper taps "I'll help" → homes in via RSSI (and exact location in P2 if
   verified + can decrypt).
5. Helper reaches her → the arrival-code handshake (already built, sql/51)
   confirms a real, in-person arrival.
6. If ANY phone gets internet meanwhile → bridge to the server → normal
   verified-helper dispatch + logging.

## The offline-trust problem (why "verified" is hard here)
With no internet, a phone CANNOT check "is this really a verified helper." So:
- The PING reaches all nearby ORBII users (more responders is better in a real
  emergency, and a ping carries no location).
- Exact location (P2) is sealed to a helper key only verified helpers hold,
  distributed + rotated + revoked by the server while online.

## Components to build
- **Native (OrbiiMeshService):** broadcast the helper PING type; helper listen
  path shows the alert + an RSSI (signal-strength) meter; (P2) broadcast +
  decrypt the helper-sealed location.
- **Crypto:** a rotating verified-helper keypair. Server hands the private key
  to a helper when they verify; rotate periodically; revoke on demand. Victim
  seals a location copy to the current helper public key. (mesh-crypto extends.)
- **App UI:** offline helper-alert screen (full-screen, warmer/colder meter,
  "I'll help" / "I'm busy"); reuse HelperOverlay for over-app display and
  HelperNavigation for the go-to-her flow; integrate arrival codes.
- **Trigger:** only when fully offline (no bridge). Victim setting to enable.
- **RSSI homing:** map scan RSSI to a rough distance band; noisy, needs
  on-device tuning. Not turn-by-turn, just warmer/colder.

## Phasing
- **P1 (safe, big value): PING + RSSI homing + I'll help + arrival code.** No
  coordinates broadcast at all. Reaches nearby helpers offline; fully safe.
- **P2:** helper-sealed exact location for VERIFIED helpers only (rotating key).
- **P3:** key rotation/revocation, battery (helper background listening), iOS,
  RSSI tuning.

## Open questions / risks
- RSSI is noisy; "warmer/colder" is approximate.
- Helper key distribution + rotation + revocation flow.
- Battery: helpers must keep listening (foreground, or helper-mode background).
- Play/permission implications of always-listening background scan.
- Depends on the base BLE mesh actually working on real devices (still untested).

## Honesty guardrails
- Never broadcast exact GPS in the clear.
- Direct-to-helper only in a true no-connectivity emergency.
- Victim can opt out.
- The threat is often nearby; short range bounds but does not remove the risk.

See [[MESH_SPEC]] for the base mesh, and sql/51 for the arrival-code handshake
this reuses.
