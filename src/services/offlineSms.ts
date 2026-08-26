/**
 * SMS lifeline: getting an SOS out with no data connection.
 *
 * THREE THINGS ABOUT THIS FILE THAT DIVERGE FROM THE OBVIOUS DESIGN, because
 * getting any of them wrong produces something that looks like it works.
 *
 * 1. THE MESSAGE IS FOR A HUMAN, NOT A PARSER. Her emergency contact is her
 *    mother. A compact binary blob delivered to her mother is a screen of
 *    gibberish and nobody comes. So the SMS is plain sentences first, and the
 *    encoded payload rides along as a short tag at the end. Another phone with
 *    ORBII installed can decode that tag into an exact fix; a human ignores it.
 *    Both readers are served by one message.
 *
 * 2. IT IS ENCODED, NOT ENCRYPTED, AND IT SAYS SO. Base64 is not encryption.
 *    Encrypting to a server key would also make the message unreadable to the
 *    one person it exists for. There IS real sealed-box crypto in this project
 *    (mesh-crypto.ts) and it is right for the mesh, where a stranger's phone
 *    relays a payload it must never read. Here the recipient IS the audience.
 *    Calling this "encrypted SMS" would be a security claim we cannot back.
 *
 * 3. ANDROID WILL NOT LET US SEND IT SILENTLY, and we deliberately do not try.
 *    SEND_SMS is a Play-restricted permission: Google rejects it for any app
 *    that is not the device's default SMS handler, and shipping it risks the
 *    listing. services/sms.ts already made this call and keeps SEND_SMS out of
 *    the manifest. So the honest ceiling is: we prepare the message, open the
 *    composer with every contact and the text filled in, and she taps send once.
 *    One tap, and the SOS goes over the cellular voice network with data off.
 *
 *    A caller that assumes this dispatched on its own has a bug. The return type
 *    is shaped so it cannot make that assumption quietly.
 */

import * as SMS from 'expo-sms';
import { NativeModules, Platform } from 'react-native';
import { bytesToB64, b64ToBytes } from '@/utils/base64';

const { OrbiiSms } = NativeModules as {
  OrbiiSms?: { sendSms(numbers: string[], message: string): Promise<number> };
};

export type SosTriggerType =
  | 'manual'
  | 'voice'
  | 'shake'
  | 'deadman'
  | 'geofence'
  | 'power_button'
  | 'unknown';

const TRIGGER_CODES: Record<SosTriggerType, number> = {
  unknown: 0,
  manual: 1,
  voice: 2,
  shake: 3,
  deadman: 4,
  geofence: 5,
  power_button: 6,
};

const CODE_TRIGGERS: SosTriggerType[] = [
  'unknown',
  'manual',
  'voice',
  'shake',
  'deadman',
  'geofence',
  'power_button',
];

export type SOSPayloadObject = {
  /** The sos_events UUID. Any casing, hyphens optional. */
  sosId: string;
  /** Unix milliseconds. */
  timestamp: number;
  lat: number;
  lng: number;
  /** 0 to 100. Rounded and clamped on encode. */
  batteryLevel: number;
  triggerType: SosTriggerType;
};

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/**
 * v1 layout, 31 bytes, big-endian.
 *
 *   [0]      uint8   format version
 *   [1..16]  16 raw bytes of the UUID
 *   [17..20] uint32  Unix SECONDS
 *   [21..24] int32   latitude  x 1e7
 *   [25..28] int32   longitude x 1e7
 *   [29]     uint8   battery percent, 0 to 100, 255 = unknown
 *   [30]     uint8   trigger code
 *
 * TWO DEPARTURES FROM THE ORIGINAL SPEC, both strict improvements at equal or
 * smaller size:
 *
 * Fixed-point int32 instead of float32 for the coordinates. Same four bytes.
 * float32 carries 24 bits of mantissa, which at Sonipat's latitude lands about
 * 1 m of error into a value that GPS already made uncertain. Degrees x 1e7 is
 * exact to roughly 1 cm and is the encoding GPS protocols themselves use.
 *
 * uint32 seconds instead of 8 bytes of milliseconds. Saves 4 bytes, needs no
 * BigInt, and overflows in 2106. Millisecond precision on the moment an SOS
 * fired is not information anybody acts on.
 *
 * The version byte is first so a future format can be recognised before a
 * decoder trusts a single byte after it.
 */
export const SMS_PAYLOAD_VERSION = 1;
export const SMS_PAYLOAD_BYTES = 31;

/** Marks the machine-readable tail so a decoder can find it in any message. */
export const PAYLOAD_TAG = 'OB1:';

const BATTERY_UNKNOWN = 255;

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`not a UUID: ${uuid}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < 16; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

function clampCoord(v: number, limit: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-limit, Math.min(limit, v));
}

/**
 * Encode to Base64. Throws only on an invalid UUID, which is a programming
 * error rather than a runtime condition; every other field is clamped.
 */
export function generateEncryptedSMSPayload(sosData: SOSPayloadObject): string {
  const buf = new ArrayBuffer(SMS_PAYLOAD_BYTES);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  view.setUint8(0, SMS_PAYLOAD_VERSION);
  bytes.set(uuidToBytes(sosData.sosId), 1);

  const seconds = Math.floor((Number.isFinite(sosData.timestamp) ? sosData.timestamp : Date.now()) / 1000);
  // >>> 0 keeps it unsigned; a nonsense clock must not write a negative.
  view.setUint32(17, Math.max(0, seconds) >>> 0, false);

  view.setInt32(21, Math.round(clampCoord(sosData.lat, 90) * 1e7), false);
  view.setInt32(25, Math.round(clampCoord(sosData.lng, 180) * 1e7), false);

  const battery = Number.isFinite(sosData.batteryLevel)
    ? Math.max(0, Math.min(100, Math.round(sosData.batteryLevel)))
    : BATTERY_UNKNOWN;
  view.setUint8(29, battery);

  view.setUint8(30, TRIGGER_CODES[sosData.triggerType] ?? 0);

  return bytesToB64(bytes);
}

/**
 * Decode a payload produced by this file. Returns null on anything malformed
 * rather than throwing, because the input is an SMS body from the outside world
 * and may be truncated, wrapped, or not ours at all.
 */
export function decodeSMSPayload(b64: string): SOSPayloadObject | null {
  try {
    const bytes = b64ToBytes(b64.trim());
    if (bytes.length < SMS_PAYLOAD_BYTES) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (view.getUint8(0) !== SMS_PAYLOAD_VERSION) return null;

    const battery = view.getUint8(29);
    return {
      sosId: bytesToUuid(bytes.subarray(1, 17)),
      timestamp: view.getUint32(17, false) * 1000,
      lat: view.getInt32(21, false) / 1e7,
      lng: view.getInt32(25, false) / 1e7,
      batteryLevel: battery === BATTERY_UNKNOWN ? -1 : battery,
      triggerType: CODE_TRIGGERS[view.getUint8(30)] ?? 'unknown',
    };
  } catch {
    return null;
  }
}

/** Pull our payload out of a received SMS body, if it carries one. */
export function extractPayloadFromSms(body: string): SOSPayloadObject | null {
  const i = body.indexOf(PAYLOAD_TAG);
  if (i < 0) return null;
  return decodeSMSPayload(body.slice(i + PAYLOAD_TAG.length).split(/\s/)[0] ?? '');
}

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

/**
 * GSM-7 is the 7-bit alphabet a plain SMS uses: 160 characters in one part.
 *
 * ONE CHARACTER OUTSIDE IT SWITCHES THE WHOLE MESSAGE TO UCS-2 AND THE LIMIT
 * DROPS TO 70. That is the trap here. buildSOSMessage in whatsapp-sos.ts opens
 * with a siren emoji, so reusing it for SMS would fragment an emergency message
 * into three parts on a weak cell, where partial delivery is exactly what
 * happens and half an address is worse than none.
 *
 * So this builds its own text and strips anything outside the alphabet.
 */
const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** These cost two characters each against the 160. */
const GSM7_EXTENDED = '^{}\\[~]|€';

const GSM7_SET = new Set([...GSM7, ...GSM7_EXTENDED]);

export const SINGLE_SMS_LIMIT = 160;

/** Replaces anything an SMS cannot carry in 7-bit form. */
export function toGsm7(input: string): string {
  let out = '';
  for (const ch of input) {
    if (GSM7_SET.has(ch)) {
      out += ch;
    } else if (ch === '’' || ch === '‘') {
      out += "'";
    } else if (ch === '“' || ch === '”') {
      out += '"';
    } else if (ch === '–' || ch === '—') {
      out += '-';
    } else if (ch === ' ') {
      out += ' ';
    } else {
      out += '';
    }
  }
  return out;
}

/** Billable length: extended characters count double. */
export function gsm7Length(text: string): number {
  let n = 0;
  for (const ch of text) n += GSM7_EXTENDED.includes(ch) ? 2 : 1;
  return n;
}

export type OfflineSmsContext = {
  senderName: string;
  /** From offlineGeo, already human-readable. */
  placeName: string | null;
  lat: number;
  lng: number;
  payload: SOSPayloadObject;
};

/**
 * One SMS, never two.
 *
 * Built in priority order and trimmed from the least important end, because on a
 * failing cell the first part is the part that arrives:
 *   1. who needs help
 *   2. the coordinates, which are always true and are what police act on
 *   3. the machine payload
 *   4. the place name, dropped first, since it is a convenience for someone who
 *      already knows the campus
 */
export function buildOfflineSmsText(ctx: OfflineSmsContext): string {
  const name = toGsm7(ctx.senderName.trim()) || 'Someone';
  const coords = `${ctx.lat.toFixed(5)},${ctx.lng.toFixed(5)}`;
  const tag = `${PAYLOAD_TAG}${generateEncryptedSMSPayload(ctx.payload)}`;

  const head = `ORBII SOS: ${name} needs help now.`;
  const core = `${head} At ${coords}`;
  const withTag = `${core} ${tag}`;

  const place = ctx.placeName ? toGsm7(ctx.placeName) : '';
  if (place) {
    const full = `${head} At ${place}, ${coords} ${tag}`;
    if (gsm7Length(full) <= SINGLE_SMS_LIMIT) return full;
  }

  if (gsm7Length(withTag) <= SINGLE_SMS_LIMIT) return withTag;

  // Cannot happen with a well-formed payload (the tag is 48 characters and the
  // core is about 60), but a pathological name must never push us into a second
  // part. Truncate the name, never the coordinates.
  const room = SINGLE_SMS_LIMIT - gsm7Length(` At ${coords} ${tag}`) - 'ORBII SOS:  needs help now.'.length;
  const shortName = name.slice(0, Math.max(3, room));
  return `ORBII SOS: ${shortName} needs help now. At ${coords} ${tag}`;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type SmsDispatchMode =
  /** Went out with no user interaction. Only if SEND_SMS was already granted. */
  | 'native_sms'
  /**
   * The composer is open, pre-filled, waiting for ONE tap.
   *
   * This is the normal Android outcome and it is NOT success. Nothing has been
   * sent. It is a separate value precisely so a caller cannot treat it as sent.
   */
  | 'composer_opened'
  /** No SMS hardware, no SIM, or no valid contact number. */
  | 'unavailable'
  | 'failed';

export type SmsDispatchResult = {
  /** True only when a message is actually gone or the composer is up. */
  success: boolean;
  mode: SmsDispatchMode;
  /** True when a human still has to tap send. Check this before claiming sent. */
  requiresUserAction: boolean;
  recipients: number;
  message: string;
  error?: string;
};

function normaliseNumbers(numbers: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of numbers) {
    if (typeof raw !== 'string') continue;
    // Keep a leading +, drop spaces, dashes and brackets that some contact
    // pickers leave in and some dialers reject.
    const cleaned = raw.trim().replace(/(?!^\+)[^\d]/g, '');
    if (cleaned.replace(/\D/g, '').length < 7) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

/**
 * Send, or get as close to sent as Android permits.
 *
 * Never throws. Every branch returns a result, because this is called on the SOS
 * path and a rejected promise here would be an unhandled rejection during an
 * emergency.
 */
export async function dispatchOfflineSMSFallback(
  sosData: SOSPayloadObject,
  emergencyContacts: string[],
  context?: { senderName?: string; placeName?: string | null },
): Promise<SmsDispatchResult> {
  let message = '';
  try {
    message = buildOfflineSmsText({
      senderName: context?.senderName ?? 'Someone',
      placeName: context?.placeName ?? null,
      lat: sosData.lat,
      lng: sosData.lng,
      payload: sosData,
    });
  } catch (err) {
    return {
      success: false,
      mode: 'failed',
      requiresUserAction: false,
      recipients: 0,
      message: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const numbers = normaliseNumbers(emergencyContacts);
  if (numbers.length === 0) {
    return {
      success: false,
      mode: 'unavailable',
      requiresUserAction: false,
      recipients: 0,
      message,
      error: 'no usable emergency contact numbers',
    };
  }

  // Silent send, only if the permission is already held. It is not requested
  // here: a permission dialog on top of an active SOS is a modal between a
  // frightened person and her alarm. services/sms.ts keeps SEND_SMS out of the
  // manifest for Play policy, so on a store build this branch never runs. It
  // stays for sideloaded and campus-distributed builds, where it legitimately
  // can.
  if (Platform.OS === 'android' && OrbiiSms) {
    try {
      const sent = await OrbiiSms.sendSms(numbers, message);
      if (sent > 0) {
        return {
          success: true,
          mode: 'native_sms',
          requiresUserAction: false,
          recipients: sent,
          message,
        };
      }
    } catch (err) {
      // Expected on a Play build: the permission is not held. Fall through to
      // the composer rather than reporting a failure.
      console.warn('[offlineSms] direct send unavailable, using composer', err);
    }
  }

  try {
    const available = await SMS.isAvailableAsync();
    if (!available) {
      return {
        success: false,
        mode: 'unavailable',
        requiresUserAction: false,
        recipients: numbers.length,
        message,
        error: 'no SMS capability on this device',
      };
    }

    const { result } = await SMS.sendSMSAsync(numbers, message);
    // expo-sms reports 'sent', 'cancelled' or 'unknown'. Android almost always
    // says 'unknown' because the OS does not tell us what happened after the
    // composer opens. Only an explicit cancel is treated as a failure; unknown
    // is reported as awaiting the tap, which is the truth.
    if (result === 'cancelled') {
      return {
        success: false,
        mode: 'failed',
        requiresUserAction: true,
        recipients: numbers.length,
        message,
        error: 'the composer was dismissed without sending',
      };
    }

    return {
      success: true,
      mode: 'composer_opened',
      requiresUserAction: true,
      recipients: numbers.length,
      message,
    };
  } catch (err) {
    return {
      success: false,
      mode: 'failed',
      requiresUserAction: false,
      recipients: numbers.length,
      message,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Is an SMS route available at all? Cheap, safe to call before an emergency. */
export async function isOfflineSmsAvailable(): Promise<boolean> {
  try {
    return await SMS.isAvailableAsync();
  } catch {
    return false;
  }
}
