import { describe, it, expect, beforeEach } from 'vitest';
import {
  isPointInPolygon,
  loadCampusZones,
  clearCampusZones,
  resolveOfflineLocation,
  CONFIDENT_THRESHOLD,
  type ZoneDefinition,
} from './offlineGeo';
import {
  generateEncryptedSMSPayload,
  decodeSMSPayload,
  extractPayloadFromSms,
  buildOfflineSmsText,
  gsm7Length,
  toGsm7,
  SINGLE_SMS_LIMIT,
  SMS_PAYLOAD_BYTES,
  type SOSPayloadObject,
} from './offlineSms';

// A square roughly 200 m on a side near Sonipat. Coordinates are invented for
// the test and never leave it; the point is the geometry, not the place.
const SQUARE: ZoneDefinition = {
  id: 'hostel-3',
  name: 'Hostel 3, Block A',
  zoneType: 'hostel',
  surveyed: true,
  polygonCoordinates: [
    { lat: 28.9930, lng: 77.0150 },
    { lat: 28.9930, lng: 77.0170 },
    { lat: 28.9948, lng: 77.0170 },
    { lat: 28.9948, lng: 77.0150 },
  ],
};

const CAMPUS: ZoneDefinition = {
  id: 'campus',
  name: 'SRM Sonipat campus',
  zoneType: 'campus_boundary',
  surveyed: false,
  polygonCoordinates: [
    { lat: 28.9900, lng: 77.0100 },
    { lat: 28.9900, lng: 77.0220 },
    { lat: 29.0000, lng: 77.0220 },
    { lat: 29.0000, lng: 77.0100 },
  ],
};

describe('point in polygon', () => {
  const sq = SQUARE.polygonCoordinates;

  it('finds an interior point', () => {
    expect(isPointInPolygon({ lat: 28.9939, lng: 77.0160 }, sq)).toBe(true);
  });

  it('rejects an exterior point', () => {
    expect(isPointInPolygon({ lat: 28.9960, lng: 77.0160 }, sq)).toBe(false);
  });

  it('is not fooled by a ray passing exactly through a vertex', () => {
    // Same latitude as two vertices, to the west of the square. A naive
    // implementation double-counts here and reports "inside".
    expect(isPointInPolygon({ lat: 28.9930, lng: 77.0100 }, sq)).toBe(false);
    expect(isPointInPolygon({ lat: 28.9948, lng: 77.0100 }, sq)).toBe(false);
  });

  it('handles a concave shape, where a bounding box would be wrong', () => {
    // An L. The notch is inside the bounding box but outside the polygon.
    const L = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 4, lng: 10 },
      { lat: 4, lng: 4 },
      { lat: 10, lng: 4 },
      { lat: 10, lng: 0 },
    ];
    expect(isPointInPolygon({ lat: 2, lng: 2 }, L)).toBe(true);
    expect(isPointInPolygon({ lat: 8, lng: 8 }, L)).toBe(false);
  });

  it('rejects a degenerate polygon rather than throwing', () => {
    expect(isPointInPolygon({ lat: 1, lng: 1 }, [{ lat: 0, lng: 0 }])).toBe(false);
  });
});

describe('resolveOfflineLocation', () => {
  beforeEach(() => clearCampusZones());

  it('returns coordinates, not a guess, when no zones are loaded', () => {
    const r = resolveOfflineLocation(28.9939, 77.0160);
    expect(r.basis).toBe('coordinates_only');
    expect(r.confidence).toBe(0);
    expect(r.zoneId).toBeNull();
    expect(r.locationName).toContain('28.99390');
  });

  it('names a surveyed zone with full confidence', () => {
    loadCampusZones([CAMPUS, SQUARE]);
    const r = resolveOfflineLocation(28.9939, 77.0160);
    expect(r.basis).toBe('inside_surveyed');
    expect(r.locationName).toBe('Hostel 3, Block A');
    expect(r.confidence).toBe(1);
    expect(r.isWithinCampus).toBe(true);
  });

  it('never reports an unsurveyed zone confidently', () => {
    loadCampusZones([{ ...SQUARE, surveyed: false }]);
    const r = resolveOfflineLocation(28.9939, 77.0160);
    expect(r.basis).toBe('inside_unsurveyed');
    expect(r.confidence).toBeLessThan(CONFIDENT_THRESHOLD);
    expect(r.locationName.startsWith('Near ')).toBe(true);
  });

  it('prefers the smaller zone over the campus boundary containing it', () => {
    loadCampusZones([CAMPUS, SQUARE]);
    expect(resolveOfflineLocation(28.9939, 77.0160).zoneId).toBe('hostel-3');
  });

  it('falls back to the nearest landmark just outside, below confident', () => {
    loadCampusZones([CAMPUS, SQUARE]);
    // ~40 m north of the square's top edge.
    const r = resolveOfflineLocation(28.99516, 77.0160);
    expect(r.basis).toBe('near_landmark');
    expect(r.nearestDistanceM).toBeGreaterThan(20);
    expect(r.nearestDistanceM).toBeLessThan(70);
    expect(r.confidence).toBeLessThan(CONFIDENT_THRESHOLD);
    expect(r.isWithinCampus).toBe(true);
  });

  it('gives up on a name when far from everything', () => {
    loadCampusZones([CAMPUS, SQUARE]);
    const r = resolveOfflineLocation(19.076, 72.877); // Mumbai
    expect(r.basis).toBe('coordinates_only');
    expect(r.isWithinCampus).toBe(false);
  });

  it('rejects Null Island rather than placing her in the Atlantic', () => {
    loadCampusZones([CAMPUS, SQUARE]);
    const r = resolveOfflineLocation(0, 0);
    expect(r.locationName).toBe('Location unavailable');
    expect(r.confidence).toBe(0);
  });

  it('survives NaN without throwing', () => {
    expect(() => resolveOfflineLocation(NaN, NaN)).not.toThrow();
    expect(resolveOfflineLocation(NaN, NaN).confidence).toBe(0);
  });

  it('skips a malformed zone instead of failing the whole load', () => {
    const res = loadCampusZones([
      SQUARE,
      { ...SQUARE, id: 'bad', polygonCoordinates: [{ lat: 1, lng: 1 }] },
    ]);
    expect(res.loaded).toBe(1);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].id).toBe('bad');
  });
});

describe('nearest landmark, large-polygon bound', () => {
  beforeEach(() => clearCampusZones());

  // ~780 m by ~400 m, so its circumscribed radius is 438 m, far beyond the
  // fixed 150 m the reject used to assume.
  const BIG: ZoneDefinition = {
    id: 'academic-block',
    name: 'Main Academic Block',
    zoneType: 'academic',
    surveyed: true,
    polygonCoordinates: [
      { lat: 28.9900, lng: 77.0100 },
      { lat: 28.9900, lng: 77.0180 },
      { lat: 28.9936, lng: 77.0180 },
      { lat: 28.9936, lng: 77.0100 },
    ],
  };

  // A few metres across, sitting 40 m north of the probe point.
  const SMALL: ZoneDefinition = {
    id: 'kiosk',
    name: 'Canteen Kiosk',
    zoneType: 'canteen',
    surveyed: true,
    polygonCoordinates: [
      { lat: 28.99399, lng: 77.01398 },
      { lat: 28.99399, lng: 77.01402 },
      { lat: 28.99403, lng: 77.01402 },
      { lat: 28.99403, lng: 77.01398 },
    ],
  };

  // 5.6 m north of the big block's top edge, 38 m from the kiosk.
  const PROBE = { lat: 28.99365, lng: 77.0140 };

  it('does not skip a large building whose centroid is far but edge is near', () => {
    // LOAD ORDER IS THE POINT. The kiosk is examined first and sets nearestM to
    // 38 m. The old reject then computed 205 (centroid distance) minus a fixed
    // 150 = 55, decided 55 > 38, and skipped the block entirely, reporting the
    // kiosk 38 m away instead of the building 6 m away.
    //
    // With the polygon's own 438 m radius the bound goes negative and the block
    // is measured properly. Verified to fail against the old constant.
    loadCampusZones([SMALL, BIG]);
    const r = resolveOfflineLocation(PROBE.lat, PROBE.lng);
    expect(r.basis).toBe('near_landmark');
    expect(r.zoneId).toBe('academic-block');
    expect(r.nearestDistanceM).toBeLessThan(15);
  });

  it('still picks the small zone when it genuinely is nearest', () => {
    // The bound must not overcorrect into always preferring large polygons.
    loadCampusZones([SMALL, BIG]);
    const r = resolveOfflineLocation(28.99396, 77.0140); // 1 m from the kiosk
    expect(r.zoneId).toBe('kiosk');
  });

  it('is unaffected by vertex winding order', () => {
    loadCampusZones([SMALL, { ...BIG, polygonCoordinates: [...BIG.polygonCoordinates].reverse() }]);
    expect(resolveOfflineLocation(PROBE.lat, PROBE.lng).zoneId).toBe('academic-block');
  });
});

describe('SMS payload', () => {
  const base: SOSPayloadObject = {
    sosId: '8ee693c9-1f2a-4b3c-9d4e-5f6a7b8c9d0e',
    timestamp: 1_756_000_000_000,
    lat: 28.99391,
    lng: 77.01604,
    batteryLevel: 42,
    triggerType: 'voice',
  };

  it('round-trips every field', () => {
    const out = decodeSMSPayload(generateEncryptedSMSPayload(base));
    expect(out).not.toBeNull();
    expect(out!.sosId).toBe(base.sosId);
    expect(out!.batteryLevel).toBe(42);
    expect(out!.triggerType).toBe('voice');
    // Seconds resolution, so the millisecond remainder is expected to be lost.
    expect(Math.abs(out!.timestamp - base.timestamp)).toBeLessThan(1000);
  });

  it('keeps coordinates accurate to better than 2 cm', () => {
    const out = decodeSMSPayload(generateEncryptedSMSPayload(base))!;
    // 1e-7 degrees is about 1.1 cm of latitude.
    expect(Math.abs(out.lat - base.lat)).toBeLessThan(2e-7);
    expect(Math.abs(out.lng - base.lng)).toBeLessThan(2e-7);
  });

  it('handles southern and western hemispheres', () => {
    const s = { ...base, lat: -33.8688, lng: -151.2093 };
    const out = decodeSMSPayload(generateEncryptedSMSPayload(s))!;
    expect(Math.abs(out.lat - s.lat)).toBeLessThan(2e-7);
    expect(Math.abs(out.lng - s.lng)).toBeLessThan(2e-7);
  });

  it('encodes to a fixed size', () => {
    // 31 bytes -> ceil(31/3)*4 = 44 base64 characters.
    expect(generateEncryptedSMSPayload(base)).toHaveLength(44);
    expect(SMS_PAYLOAD_BYTES).toBe(31);
  });

  it('marks an unknown battery rather than reporting zero percent', () => {
    const out = decodeSMSPayload(
      generateEncryptedSMSPayload({ ...base, batteryLevel: NaN }),
    )!;
    expect(out.batteryLevel).toBe(-1);
  });

  it('clamps a battery reading outside 0 to 100', () => {
    const out = decodeSMSPayload(generateEncryptedSMSPayload({ ...base, batteryLevel: 380 }))!;
    expect(out.batteryLevel).toBe(100);
  });

  it('rejects a bad UUID loudly, because that is a programming error', () => {
    expect(() => generateEncryptedSMSPayload({ ...base, sosId: 'nope' })).toThrow();
  });

  it('returns null on garbage instead of throwing', () => {
    expect(decodeSMSPayload('not base64 at all !!')).toBeNull();
    expect(decodeSMSPayload('')).toBeNull();
    expect(decodeSMSPayload('AAAA')).toBeNull();
  });
});

describe('SMS text', () => {
  const payload: SOSPayloadObject = {
    sosId: '8ee693c9-1f2a-4b3c-9d4e-5f6a7b8c9d0e',
    timestamp: 1_756_000_000_000,
    lat: 28.99391,
    lng: 77.01604,
    batteryLevel: 42,
    triggerType: 'manual',
  };

  it('fits in ONE part with a place name', () => {
    const text = buildOfflineSmsText({
      senderName: 'Ananya Sharma',
      placeName: 'Hostel 3, Block A',
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(gsm7Length(text)).toBeLessThanOrEqual(SINGLE_SMS_LIMIT);
    expect(text).toContain('Ananya Sharma');
    expect(text).toContain('28.99391');
  });

  it('drops the place name before it drops the coordinates', () => {
    const text = buildOfflineSmsText({
      senderName: 'Ananya Sharma',
      placeName: 'A very long building description that will never fit inside one message',
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(gsm7Length(text)).toBeLessThanOrEqual(SINGLE_SMS_LIMIT);
    expect(text).toContain('28.99391');
    expect(text).toContain('77.01604');
  });

  it('still fits with an absurd name', () => {
    const text = buildOfflineSmsText({
      senderName: 'x'.repeat(400),
      placeName: 'Central Library',
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(gsm7Length(text)).toBeLessThanOrEqual(SINGLE_SMS_LIMIT);
    expect(text).toContain('28.99391');
  });

  it('carries a payload the receiver can decode back out', () => {
    const text = buildOfflineSmsText({
      senderName: 'Ananya',
      placeName: 'Hostel 3',
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    const back = extractPayloadFromSms(text);
    expect(back).not.toBeNull();
    expect(back!.sosId).toBe(payload.sosId);
    expect(Math.abs(back!.lat - payload.lat)).toBeLessThan(2e-7);
  });

  it('keeps an ordinary ASCII name intact', () => {
    const text = buildOfflineSmsText({
      senderName: 'Ananya Sharma',
      placeName: null,
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(text).toContain('Ananya Sharma');
    expect(text).not.toContain('Someone');
  });

  it('falls back to Someone when the name is entirely non-Latin', () => {
    // Devanagari reduces to a single space under GSM-7. The old code used
    // `toGsm7(name) || 'Someone'`, and a space is truthy, so the message read
    // "ORBII SOS:  needs help now" with the name simply gone.
    const text = buildOfflineSmsText({
      senderName: 'अनन्या शर्मा',
      placeName: null,
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(text).toContain('Someone needs help now');
    expect(text).not.toMatch(/SOS:\s{2,}/); // no double space where a name should be
    expect(gsm7Length(text)).toBeLessThanOrEqual(SINGLE_SMS_LIMIT);
  });

  it('falls back rather than sending a mangled fragment of a mixed name', () => {
    // "Ananya" survives, the surname does not. Emitting "Ananya " reads to the
    // recipient as a bug, so it is only used when most of the name survives.
    const text = buildOfflineSmsText({
      senderName: 'A शर्मा',
      placeName: null,
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(text).toContain('Someone');
  });

  it('keeps a mostly-Latin name that only loses an accent or two', () => {
    // Above the 0.6 survival bar, so it is still her name and still useful.
    const text = buildOfflineSmsText({
      senderName: 'Priya Raghunathanॐ',
      placeName: null,
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(text).toContain('Priya Raghunathan');
  });

  it('falls back on an empty or whitespace-only name', () => {
    for (const raw of ['', '   ']) {
      const text = buildOfflineSmsText({
        senderName: raw,
        placeName: null,
        lat: payload.lat,
        lng: payload.lng,
        payload,
      });
      expect(text).toContain('Someone needs help now');
    }
  });

  it('never loses the coordinates, whatever happens to the name', () => {
    const text = buildOfflineSmsText({
      senderName: 'अनन्या',
      placeName: null,
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(text).toContain('28.99391');
    expect(text).toContain('77.01604');
    expect(extractPayloadFromSms(text)).not.toBeNull();
  });

  it('never exceeds one part even when the name budget goes negative', () => {
    // The old fallback forced a 3-character slice via Math.max(3, room) and
    // returned WITHOUT re-measuring, so the branch whose only job is guaranteeing
    // a single part could emit two.
    for (const len of [0, 1, 5, 200, 2000]) {
      const text = buildOfflineSmsText({
        senderName: 'x'.repeat(len),
        placeName: 'y'.repeat(len),
        lat: -33.86880,
        lng: -151.20930, // widest coordinates: two signs, six integer digits
        payload,
      });
      expect(gsm7Length(text)).toBeLessThanOrEqual(SINGLE_SMS_LIMIT);
      expect(text).toContain('-33.86880');
      expect(extractPayloadFromSms(text)).not.toBeNull();
    }
  });

  it('keeps coordinates and payload even in the atomic minimum form', () => {
    const text = buildOfflineSmsText({
      senderName: 'z'.repeat(5000),
      placeName: null,
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(gsm7Length(text)).toBeLessThanOrEqual(SINGLE_SMS_LIMIT);
    expect(text).toContain('ORBII SOS');
    expect(extractPayloadFromSms(text)!.sosId).toBe(payload.sosId);
  });

  it('strips characters that would force UCS-2 and halve the limit', () => {
    // The siren emoji in whatsapp-sos.ts buildSOSMessage is exactly this trap.
    const cleaned = toGsm7('SOS 🚨 help — now’s the time');
    expect(cleaned).not.toContain('🚨');
    expect(cleaned).toContain('-');
    expect(cleaned).toContain("'");
    const text = buildOfflineSmsText({
      senderName: 'Ananya 🚨',
      placeName: 'Café — Block B',
      lat: payload.lat,
      lng: payload.lng,
      payload,
    });
    expect(text).not.toContain('🚨');
    expect(gsm7Length(text)).toBeLessThanOrEqual(SINGLE_SMS_LIMIT);
  });
});
