// The ShockDetector state machine is what the tests exercise, and it is pure.
// initVolumetricMonitor is the thin layer that feeds it real accelerometer
// frames, and that is verified on a phone by dropping one, not in Node.
export const Accelerometer = {
  setUpdateInterval(_ms: number): void {},
  addListener(_cb: (d: { x: number; y: number; z: number }) => void) {
    return { remove(): void {} };
  },
  async isAvailableAsync(): Promise<boolean> {
    return false;
  },
};
