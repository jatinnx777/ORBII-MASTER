// The incident report, as HTML, with no dependency on anything native.
//
// Pure on purpose. The report is a document somebody may put in front of the
// police, so what it says has to be testable without a phone: every figure in it
// is built here from plain data, and incident-report.ts only gathers that data
// and turns this string into a PDF.
//
// WHAT IT WILL NOT DO. It never states anything ORBII does not actually hold.
// No trail means "no stored trail", not an empty map that looks like she did not
// move. A responder with no arrival time is listed without one, not given a
// plausible time. And it says plainly that it is generated on the phone and is
// not a police document.

import type { SOSRecord } from '../types';

export type TrailPoint = { lat: number; lng: number; at: number };

export type IncidentReportInput = {
  record: SOSRecord;
  /** The person the SOS belongs to, as named on this phone. */
  reporterName: string | null;
  /** Stored location fixes inside the incident window. Empty when none exist. */
  trail: TrailPoint[];
  /** Whether an SOS audio recording is saved on this phone. */
  hasRecording: boolean;
  recordingName: string | null;
  generatedAt: number;
  appVersion?: string | null;
  /** SHA-256 of incidentReportCanonical(), when it could be computed. */
  fingerprint?: string | null;
};

/** How long after the start a still-open SOS is assumed to cover, for the trail. */
export const OPEN_INCIDENT_WINDOW_MS = 3 * 60 * 60 * 1000;
/** Fixes from shortly before the SOS show where she was coming from. */
export const TRAIL_LEAD_MS = 5 * 60 * 1000;
/** A PDF with 500 rows of coordinates is unreadable. */
export const MAX_TRAIL_ROWS = 60;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** India Standard Time, always, whatever timezone the phone is set to. */
export function formatIST(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${date}, ${time} IST`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'Unknown';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

export function triggerLabel(trigger: SOSRecord['trigger']): string {
  switch (trigger) {
    case 'voice':
      return 'Voice SOS (a spoken trigger word)';
    case 'impact':
      return 'Impact detection (a hard knock, then no movement)';
    case 'geofence':
      return 'Safe zone departure';
    case 'disaster':
      return 'Disaster mode';
    case 'scream':
      return 'Scream detection';
    case 'shake':
      return 'Silent shake SOS';
    case 'manual':
    default:
      return 'SOS button';
  }
}

export function statusLabel(status: SOSRecord['status']): string {
  switch (status) {
    case 'resolved':
      return 'Resolved';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Still active when this report was generated';
  }
}

export function mapsLink(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Whether a record has a usable start location. createSOS writes 0,0 when there was no fix. */
export function hasStartLocation(record: SOSRecord): boolean {
  const { latitude, longitude } = record.location;
  return Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
}

/**
 * The fixes that belong to this incident: from a few minutes before it started
 * to when it ended, or to three hours in if it never ended.
 */
export function trailWithinIncident(
  points: TrailPoint[],
  record: SOSRecord,
  now: number,
): TrailPoint[] {
  const from = record.timestamp - TRAIL_LEAD_MS;
  const to = record.resolvedAt ?? Math.min(now, record.timestamp + OPEN_INCIDENT_WINDOW_MS);
  return points
    .filter((p) => p.at >= from && p.at <= to)
    .sort((a, b) => a.at - b.at);
}

/** Thin a long trail evenly, always keeping the first and last fix. */
export function sampleTrail(points: TrailPoint[], max = MAX_TRAIL_ROWS): TrailPoint[] {
  if (points.length <= max) return points;
  const out: TrailPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/**
 * The facts in the report, in a fixed order, WITHOUT the time it was generated.
 * Hashing this means regenerating the report from the same records produces the
 * same fingerprint, and editing any figure changes it.
 */
export function incidentReportCanonical(input: IncidentReportInput): string {
  const r = input.record;
  return JSON.stringify({
    id: r.id,
    kind: r.kind ?? 'real',
    status: r.status,
    trigger: r.trigger ?? 'manual',
    startedAt: r.timestamp,
    resolvedAt: r.resolvedAt,
    lat: r.location.latitude,
    lng: r.location.longitude,
    address: r.location.address ?? null,
    alerted: (r.alerted ?? []).map((a) => [a.name, a.via]),
    responders: r.responders.map((h) => [h.id, h.name]),
    responder: r.responder?.id ?? null,
    responseTime: r.responseTime,
    trail: input.trail.map((p) => [p.at, p.lat, p.lng]),
    recording: input.hasRecording ? input.recordingName : null,
  });
}

type TimelineRow = { at: number | null; text: string };

export function buildTimeline(record: SOSRecord): TimelineRow[] {
  const rows: TimelineRow[] = [
    { at: record.timestamp, text: `SOS raised by ${triggerLabel(record.trigger).toLowerCase()}` },
  ];
  const alerted = record.alerted ?? [];
  if (alerted.length > 0) {
    rows.push({
      at: record.timestamp,
      text: `Alert sent to ${alerted.length} ${alerted.length === 1 ? 'person' : 'people'} set up on this phone`,
    });
  }
  if (record.responders.length > 0) {
    rows.push({
      at: null,
      text: `${record.responders.length} ${record.responders.length === 1 ? 'person' : 'people'} responded`,
    });
  }
  if (record.status === 'resolved' && record.resolvedAt != null) {
    rows.push({ at: record.resolvedAt, text: 'SOS marked resolved' });
  } else if (record.status === 'cancelled') {
    rows.push({ at: record.resolvedAt, text: 'SOS cancelled' });
  }
  return rows;
}

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1c1b1f; margin: 0; padding: 32px 36px; font-size: 11.5px; line-height: 1.5; }
  header { border-bottom: 2px solid #1c1b1f; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: #5f5a66; margin: 0 0 6px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .meta { color: #5f5a66; margin: 0; }
  .practice { display: inline-block; margin-top: 8px; padding: 3px 8px; border: 1.5px solid #9a6b00; color: #9a6b00; font-weight: 700; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
  h2 { font-size: 13px; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d9d4cc; text-transform: uppercase; letter-spacing: 0.08em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 5px 8px 5px 0; border-bottom: 1px solid #ece8e1; }
  th { width: 34%; color: #5f5a66; font-weight: 600; }
  .grid th { width: auto; }
  .muted { color: #5f5a66; }
  a { color: #0b3c29; }
  .mono { font-family: 'Roboto Mono', Menlo, monospace; font-size: 10px; word-break: break-all; }
  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #d9d4cc; color: #5f5a66; font-size: 10px; }
`;

export function buildIncidentReportHtml(input: IncidentReportInput): string {
  const r = input.record;
  const isPractice = r.kind === 'test';
  const started = formatIST(r.timestamp);
  const ended = r.resolvedAt != null ? formatIST(r.resolvedAt) : statusLabel(r.status);
  const duration = r.resolvedAt != null ? formatDuration(r.resolvedAt - r.timestamp) : 'Not ended';
  const hasLoc = hasStartLocation(r);
  const rows = sampleTrail(input.trail);

  const summary = `
    <table>
      <tr><th>Status</th><td>${escapeHtml(statusLabel(r.status))}</td></tr>
      <tr><th>What started it</th><td>${escapeHtml(triggerLabel(r.trigger))}</td></tr>
      <tr><th>Started</th><td>${escapeHtml(started)}</td></tr>
      <tr><th>Ended</th><td>${escapeHtml(ended)}</td></tr>
      <tr><th>Duration</th><td>${escapeHtml(duration)}</td></tr>
      <tr><th>Location when raised</th><td>${
        hasLoc
          ? `${escapeHtml(r.location.address ?? 'Address not resolved')}<br />
             <span class="mono">${r.location.latitude.toFixed(6)}, ${r.location.longitude.toFixed(6)}</span><br />
             <a href="${escapeHtml(mapsLink(r.location.latitude, r.location.longitude))}">Open in Google Maps</a>`
          : 'No location fix was available when the SOS was raised.'
      }</td></tr>
      <tr><th>SOS reference</th><td class="mono">${escapeHtml(r.id)}</td></tr>
    </table>`;

  const timeline = `
    <table class="grid">
      <tr><th>Time</th><th>Event</th></tr>
      ${buildTimeline(r)
        .map(
          (t) =>
            `<tr><td>${t.at != null ? escapeHtml(formatIST(t.at)) : '<span class="muted">Time not recorded</span>'}</td><td>${escapeHtml(t.text)}</td></tr>`,
        )
        .join('')}
    </table>`;

  const trail =
    rows.length === 0
      ? '<p class="muted">No stored location trail covers this period. Location history is kept for 7 days, and only while location sharing or an SOS was active.</p>'
      : `
    <p class="muted">${input.trail.length} stored location ${input.trail.length === 1 ? 'fix' : 'fixes'}${
      rows.length < input.trail.length ? `, ${rows.length} shown at even intervals` : ''
    }.</p>
    <table class="grid">
      <tr><th>Time</th><th>Latitude, longitude</th><th>Map</th></tr>
      ${rows
        .map(
          (p) =>
            `<tr><td>${escapeHtml(formatIST(p.at))}</td><td class="mono">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</td><td><a href="${escapeHtml(mapsLink(p.lat, p.lng))}">View</a></td></tr>`,
        )
        .join('')}
    </table>`;

  const recordings = input.hasRecording
    ? `<p>An audio recording of this SOS is saved on the phone${
        input.recordingName ? ` as <span class="mono">${escapeHtml(input.recordingName)}</span>` : ''
      }. It is not embedded in this document. Share the original file separately so its details are preserved.</p>`
    : '<p class="muted">No audio recording of this SOS is saved on this phone.</p>';

  const alertedList = r.alerted ?? [];
  const alerted =
    alertedList.length === 0
      ? '<p class="muted">This SOS was raised before ORBII recorded who was alerted, or nobody was set up to receive it.</p>'
      : `<p class="muted">The people this SOS was sent to when it went out, as set up on this phone. Delivery to each person's phone is not confirmed here.</p>
        <table class="grid">
          <tr><th>Name</th><th>How they are connected</th></tr>
          ${alertedList
            .map(
              (a) =>
                `<tr><td>${escapeHtml(a.name)}</td><td>${a.via === 'contact' ? 'Emergency contact' : 'Circle member'}</td></tr>`,
            )
            .join('')}
        </table>`;

  const responders =
    r.responders.length === 0
      ? '<p class="muted">Nobody was recorded as responding.</p>'
      : `<table class="grid">
          <tr><th>Name</th><th>Role</th></tr>
          ${r.responders
            .map(
              (h) =>
                `<tr><td>${escapeHtml(h.name)}</td><td>${r.responder?.id === h.id ? 'Responder' : 'Responded'}</td></tr>`,
            )
            .join('')}
        </table>
        ${
          r.responseTime != null
            ? `<p class="muted">Time from the SOS to resolution: ${escapeHtml(formatDuration(r.responseTime * 1000))}.</p>`
            : ''
        }`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>ORBII incident report ${escapeHtml(r.id)}</title>
<style>${STYLE}</style>
</head>
<body>
  <header>
    <p class="brand">ORBII Safety</p>
    <h1>Incident report</h1>
    <p class="meta">${escapeHtml(input.reporterName ?? r.userName ?? 'ORBII user')} &middot; Generated ${escapeHtml(formatIST(input.generatedAt))}</p>
    ${isPractice ? '<span class="practice">Practice SOS. No real alert was sent.</span>' : ''}
  </header>

  <h2>Summary</h2>
  ${summary}

  <h2>Timeline</h2>
  ${timeline}

  <h2>Location trail</h2>
  ${trail}

  <h2>Recordings</h2>
  ${recordings}

  <h2>Who was alerted</h2>
  ${alerted}

  <h2>Who responded</h2>
  ${responders}

  <footer>
    <p>This report was generated on the phone by the ORBII app${
      input.appVersion ? ` (version ${escapeHtml(input.appVersion)})` : ''
    } from records stored for this SOS. It is not a police document and has not been verified by ORBII. All times are India Standard Time.</p>
    ${
      input.fingerprint
        ? `<p>Fingerprint of the facts above (SHA-256): <span class="mono">${escapeHtml(input.fingerprint)}</span>. Generating the report again from the same records gives the same value. It changes if location history for this period has since been deleted.</p>`
        : ''
    }
  </footer>
</body>
</html>`;
}
