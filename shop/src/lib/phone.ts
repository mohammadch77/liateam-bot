/**
 * Iranian mobile numbers. Everything is stored in one canonical form: 09XXXXXXXXX (matches the DB CHECK).
 * Accepts what people actually type: Persian/Arabic digits, spaces, dashes, +98 / 0098 / 98 / 9… prefixes.
 */
const DIGIT_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export const toLatinDigits = (s: string): string => s.replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d);

/** → '09121234567', or null when it is not an Iranian mobile number. */
export function normalizeMobile(input: string): string | null {
  let d = toLatinDigits(String(input ?? '')).replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0098')) d = d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('9')) d = `0${d}`;
  return /^09\d{9}$/.test(d) ? d : null;
}

/** '09121234567' → '0912•••4567' for logs and confirmation messages. */
export const maskMobile = (phone: string): string => `${phone.slice(0, 4)}•••${phone.slice(-4)}`;

/** Only digits, Latin; e.g. the OTP field. */
export const digitsOnly = (s: string): string => toLatinDigits(String(s ?? '')).replace(/\D/g, '');
