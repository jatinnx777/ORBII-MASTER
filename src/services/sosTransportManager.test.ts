import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __setConnected } from '../../test/stubs/netinfo';
import { clearCampusZones } from './offlineGeo';
import {
  dispatchSOS,
  describeTransportResult,
  ONLINE_ATTEMPT_TIMEOUT_MS,
  type TransportRequest,
} from './sosTransportManager';
import type { SOSPayloadObject } from './offlineSms';

/**
 * The question these tests answer is not "did it send" but "did it tell the
 * truth about what it sent". A transport layer that reports the wrong route
 * makes every downstream decision, telemetry and on-screen sentence wrong, and
 * on this product the on-screen sentence is what a frightened person acts on.
 */

const payload: SOSPayloadObject = {
  sosId: '8ee693c9-1f2a-4b3c-9d4e-5f6a7b8c9d0e',
  timestamp: 1_756_000_000_000,
  lat: 28.99391,
  lng: 77.01604,
  batteryLevel: 55,
  triggerType: 'manual',
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function req(overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    payload,
    emergencyContacts: ['+919999999999'],
    senderName: 'Ananya',
    transmitOnline: async () => undefined,
    ...overrides,
  };
}

describe('dispatchSOS route reporting', () => {
  beforeEach(() => {
    clearCampusZones();
    __setConnected(true);
  });

  afterEach(() => {
    __setConnected(false);
  });

  it('reports online when the online path completes inside the deadline', async () => {
    const r = await dispatchSOS(req({ transmitOnline: async () => undefined }));
    expect(r.route).toBe('online');
    expect(r.delivered).toBe(true);
    expect(r.requiresUserAction).toBe(false);
    expect(r.lateOnlineSuccess).toBeFalsy();
  });

  it('does NOT report online when the promise settles in time but rejects', async () => {
    // A rejection inside the deadline is still a failure. The old code returned
    // 'online' on any settlement because it never inspected the outcome.
    const r = await dispatchSOS(
      req({
        transmitOnline: async () => {
          throw new Error('server said no');
        },
      }),
    );
    expect(r.route).not.toBe('online');
    expect(r.onlineFailureReason).toBeTruthy();
  });

  it('flags a late online success instead of claiming the SMS delivered', async () => {
    // THE BUG. The online promise loses the race, we fall back to SMS, and then
    // it lands anyway. route said 'sms' and telemetry recorded a delivery that
    // did not happen by that route.
    const r = await dispatchSOS(
      req({
        transmitOnline: async () => {
          await wait(ONLINE_ATTEMPT_TIMEOUT_MS + 120);
        },
      }),
    );
    expect(r.lateOnlineSuccess).toBe(true);
    expect(r.delivered).toBe(true);
    // The alarm is out, so she must not be told to go and tap send.
    expect(r.requiresUserAction).toBe(false);
    expect(describeTransportResult(r)).toContain('have been alerted');
  }, 10_000);

  it('does not flag a late success when the late attempt also fails', async () => {
    const r = await dispatchSOS(
      req({
        transmitOnline: async () => {
          await wait(ONLINE_ATTEMPT_TIMEOUT_MS + 120);
          throw new Error('failed late too');
        },
      }),
    );
    expect(r.lateOnlineSuccess).toBe(false);
  }, 10_000);

  it('goes straight to the fallback when offline, without calling transmitOnline', async () => {
    __setConnected(false);
    let called = false;
    const r = await dispatchSOS(
      req({
        transmitOnline: async () => {
          called = true;
        },
      }),
    );
    expect(called).toBe(false);
    expect(r.onlineFailureReason).toBe('no usable network connection');
    expect(r.lateOnlineSuccess).toBe(false);
  });

  it('never throws, even when transmitOnline throws synchronously', async () => {
    await expect(
      dispatchSOS(
        req({
          transmitOnline: () => {
            throw new Error('sync boom');
          },
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('falls back to the offline place name when the geocode hangs', async () => {
    const r = await dispatchSOS(
      req({
        resolveOnlineLocation: async () => {
          await wait(ONLINE_ATTEMPT_TIMEOUT_MS + 200);
          return 'Too Late Road';
        },
      }),
    );
    // No zones loaded, so the offline resolver answers with coordinates.
    expect(r.locationName).toContain('28.99391');
    expect(r.locationName).not.toContain('Too Late Road');
  }, 10_000);

  it('describes a failure as a failure, never as the good state', async () => {
    const bad = {
      route: 'none' as const,
      delivered: false,
      requiresUserAction: false,
      locationName: 'somewhere',
      onlineFailureReason: 'dead',
    };
    expect(describeTransportResult(bad)).toContain('112');
  });
});
