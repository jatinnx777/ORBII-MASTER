import { describe, expect, it } from 'vitest';
import type { SOSRecord } from '../types';
import {
  buildIncidentReportHtml,
  escapeHtml,
  incidentReportCanonical,
  sampleTrail,
  trailWithinIncident,
  triggerLabel,
  type IncidentReportInput,
  type TrailPoint,
} from './incident-report-html';

const START = Date.UTC(2026, 8, 16, 15, 30, 0); // 16 Sep 2026, 21:00 IST

function record(overrides: Partial<SOSRecord> = {}): SOSRecord {
  return {
    id: '7c1d9a1e-0000-4000-8000-000000000001',
    userId: 'user-1',
    userName: 'Aditi',
    userPhoto: null,
    location: { latitude: 28.6139, longitude: 77.209, address: 'Connaught Place, New Delhi' },
    timestamp: START,
    status: 'resolved',
    kind: 'real',
    trigger: 'voice',
    responders: [],
    responder: null,
    responseTime: null,
    resolvedAt: START + 12 * 60 * 1000,
    rating: null,
    ...overrides,
  };
}

function input(overrides: Partial<IncidentReportInput> = {}): IncidentReportInput {
  return {
    record: record(),
    reporterName: 'Aditi',
    trail: [],
    hasRecording: false,
    recordingName: null,
    generatedAt: START + 60 * 60 * 1000,
    ...overrides,
  };
}

describe('incident report', () => {
  it('escapes anything that came from a person, so a name cannot inject markup', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    const html = buildIncidentReportHtml(
      input({
        record: record({
          responders: [{ id: 'h1', name: '<img src=x onerror=alert(1)>', photoUri: null, rating: 5 }],
        }),
      }),
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('names what started the SOS, including the two new triggers', () => {
    expect(triggerLabel('scream')).toBe('Scream detection');
    expect(triggerLabel('shake')).toBe('Silent shake SOS');
    expect(triggerLabel(undefined)).toBe('SOS button');
    expect(buildIncidentReportHtml(input({ record: record({ trigger: 'shake' }) }))).toContain('Silent shake SOS');
  });

  it('lists who was alerted and who responded, by name', () => {
    const html = buildIncidentReportHtml(
      input({
        record: record({
          alerted: [
            { name: 'Mum', via: 'contact' },
            { name: 'Priya', via: 'circle' },
          ],
          responders: [{ id: 'h1', name: 'Rahul', photoUri: null, rating: 5 }],
          responder: { id: 'h1', name: 'Rahul', photoUri: null, rating: 5 },
        }),
      }),
    );
    expect(html).toContain('Mum');
    expect(html).toContain('Emergency contact');
    expect(html).toContain('Priya');
    expect(html).toContain('Circle member');
    expect(html).toContain('Rahul');
  });

  it('says so plainly when there is no trail, instead of drawing nothing', () => {
    expect(buildIncidentReportHtml(input())).toContain('No stored location trail covers this period');
  });

  it('marks a practice SOS so it can never be mistaken for a real one', () => {
    expect(buildIncidentReportHtml(input({ record: record({ kind: 'test' }) }))).toContain(
      'Practice SOS. No real alert was sent.',
    );
  });

  it('does not invent a location when the SOS had no fix', () => {
    const html = buildIncidentReportHtml(
      input({ record: record({ location: { latitude: 0, longitude: 0, address: null } }) }),
    );
    expect(html).toContain('No location fix was available');
    expect(html).not.toContain('maps.google.com/?q=0.000000');
  });

  it('keeps only fixes inside the incident window, in time order', () => {
    const points: TrailPoint[] = [
      { lat: 1, lng: 1, at: START - 60 * 60 * 1000 }, // an hour before: out
      { lat: 3, lng: 3, at: START + 5 * 60 * 1000 },
      { lat: 2, lng: 2, at: START - 2 * 60 * 1000 }, // just before: in
      { lat: 4, lng: 4, at: START + 30 * 60 * 1000 }, // after it was resolved: out
    ];
    const kept = trailWithinIncident(points, record(), START + 2 * 60 * 60 * 1000);
    expect(kept.map((p) => p.lat)).toEqual([2, 3]);
  });

  it('thins a long trail but always keeps the first and last fix', () => {
    const points = Array.from({ length: 500 }, (_, i) => ({ lat: i, lng: i, at: START + i * 1000 }));
    const rows = sampleTrail(points, 60);
    expect(rows).toHaveLength(60);
    expect(rows[0].lat).toBe(0);
    expect(rows[59].lat).toBe(499);
  });

  it('fingerprints the facts, not the moment the report was made', () => {
    const a = incidentReportCanonical(input({ generatedAt: START + 1000 }));
    const b = incidentReportCanonical(input({ generatedAt: START + 999_999 }));
    expect(a).toBe(b);
    const c = incidentReportCanonical(input({ record: record({ status: 'cancelled' }) }));
    expect(c).not.toBe(a);
  });
});
