// Hardware ids need a device. The referral tests cover code parsing and
// normalisation, which are pure; the id itself is verified on a phone.
export function getAndroidId(): string {
  return '';
}
export async function getIosIdForVendorAsync(): Promise<string | null> {
  return null;
}
