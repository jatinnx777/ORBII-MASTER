// WakeWordProvider — small abstraction over whichever wake-word engine
// is active. Today: Porcupine (foreground microphone service + on-device
// inference). Tomorrow: OpenWakeWord (free, MIT-licensed) once we
// integrate the TFLite path. The contract is intentionally small so
// engine swaps don't ripple through the app.

export type WakeKeyword = string;

export type StartArgs = {
  // Optional override key. Most callers should leave this blank — the
  // provider resolves a key in this order:
  //   1. Explicit `accessKey` argument (advanced / testing)
  //   2. APK-bundled key (BuildConfig.PICOVOICE_ACCESS_KEY)
  //   3. User-saved key in SecureStore (legacy setup screen)
  accessKey?: string;
  keyword?: WakeKeyword;
  onWake: (keyword: string) => void;
};

export type WakeWordHandle = {
  stop: () => Promise<void>;
};

// Reasons the provider couldn't start. Surfaced to the UI so we can
// show actionable copy without leaking implementation details.
export type StartFailure =
  | { reason: 'unavailable'; message: string }
  | { reason: 'no_key'; message: string }
  | { reason: 'engine_error'; message: string };

export type StartResult =
  | { ok: true; handle: WakeWordHandle }
  | { ok: false; failure: StartFailure };

export interface WakeWordProvider {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): boolean;
  start(args: StartArgs): Promise<StartResult>;
}
