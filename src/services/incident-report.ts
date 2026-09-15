// Export an SOS as a PDF and hand it to the share sheet.
//
// This file only GATHERS: the stored trail for the incident window, whether a
// recording is on the phone, and a fingerprint of the facts. Everything the
// report actually says is built in incident-report-html.ts, which is pure and
// tested, because a document that may be read by the police is not the place for
// untested string building.

import * as Crypto from 'expo-crypto';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { APP_VERSION } from './app-info';
import { loadTrip } from './replay';
import { hasSosRecording, sosRecordingUri } from './sos-recording';
import {
  buildIncidentReportHtml,
  incidentReportCanonical,
  trailWithinIncident,
  type IncidentReportInput,
  type TrailPoint,
} from './incident-report-html';
import type { SOSRecord } from '@/types';

export type ExportResult = 'shared' | 'saved' | 'failed';

export async function exportIncidentReport(
  record: SOSRecord,
  reporterName: string | null,
): Promise<ExportResult> {
  try {
    // The trail is best-effort. Location history is kept for 7 days and only
    // exists while sharing or an SOS was on, so "no trail" is a real and common
    // answer, and the report says so rather than failing.
    let trail: TrailPoint[] = [];
    try {
      const trip = await loadTrip(record.userId, 168);
      if (trip) {
        trail = trailWithinIncident(
          trip.points.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at })),
          record,
          Date.now(),
        );
      }
    } catch {
      trail = [];
    }

    const hasRecording = hasSosRecording(record.id);
    const recordingName = hasRecording ? (sosRecordingUri(record.id).split('/').pop() ?? null) : null;

    const base: IncidentReportInput = {
      record,
      reporterName,
      trail,
      hasRecording,
      recordingName,
      generatedAt: Date.now(),
      appVersion: APP_VERSION ?? null,
    };

    let fingerprint: string | null = null;
    try {
      fingerprint = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        incidentReportCanonical(base),
      );
    } catch {
      fingerprint = null;
    }

    const html = buildIncidentReportHtml({ ...base, fingerprint });
    // A4 in points.
    const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'Share incident report',
      });
      return 'shared';
    }
    return 'saved';
  } catch (err) {
    console.warn('[incident-report] export failed', err);
    return 'failed';
  }
}
