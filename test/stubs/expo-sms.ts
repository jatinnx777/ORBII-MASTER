// expo-sms needs a device. The offline SMS tests cover the pure encoder and the
// message builder; dispatch is hardware behaviour and is verified on a phone,
// not here. These stubs exist so importing the module does not drag
// expo-modules-core into a Node test run.
export async function isAvailableAsync(): Promise<boolean> {
  return false;
}
export async function sendSMSAsync(): Promise<{ result: string }> {
  return { result: 'unknown' };
}
