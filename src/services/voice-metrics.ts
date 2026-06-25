import { NativeModules } from 'react-native';

// Live recognition diagnostics from the native VoiceGuard service, polled by
// the hidden Voice Debug screen so we can measure real-world detection before
// vs after tuning (pocket / purse / distance / noise).

const { VoiceGuard } = NativeModules as {
  VoiceGuard?: {
    getVoiceMetrics(): Promise<VoiceMetrics>;
    resetVoiceMetrics(): Promise<boolean>;
  };
};

export type VoiceMetrics = {
  running: boolean;
  grammarMode: boolean;
  rms: number;
  vadActive: boolean;
  vadThreshold: number;
  gain: number;
  lastText: string;
  lastConfidence: number;
  lastTriggerPhrase: string;
  lastTriggerAtMs: number;
  lastLatencyMs: number;
  triggerCount: number;
  avgLatencyMs: number;
};

export const voiceMetricsSupported = !!VoiceGuard?.getVoiceMetrics;

export async function getVoiceMetrics(): Promise<VoiceMetrics | null> {
  if (!VoiceGuard?.getVoiceMetrics) return null;
  try {
    return await VoiceGuard.getVoiceMetrics();
  } catch {
    return null;
  }
}

export async function resetVoiceMetrics(): Promise<void> {
  try {
    await VoiceGuard?.resetVoiceMetrics();
  } catch {
    // ignore
  }
}
