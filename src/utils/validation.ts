export function isValidIndianPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 10) return false;
  return /^[6-9]\d{9}$/.test(digits);
}

export function isValidOtp(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 50;
}

export function formatPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

export function toE164India(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return `+91${digits}`;
}
