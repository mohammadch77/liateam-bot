/**
 * Iranian IBAN (شبا): «IR» + 24 digits, checked with the standard mod-97 rule (the letters I and R count as 18 and 27).
 * Pure; the number is only ever stored in its own column and shown masked.
 */
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

/** «ir 12 …» in any digits and spacing → IR + digits (not yet validated) */
export function normalizeIban(raw: string): string {
  const latin = [...raw].map((c) => {
    const p = PERSIAN.indexOf(c);
    if (p >= 0) return String(p);
    const a = ARABIC.indexOf(c);
    return a >= 0 ? String(a) : c;
  });
  return latin
    .join('')
    .replace(/[\s\-_.‌‏]/g, '')
    .toUpperCase();
}

export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^IR[0-9]{24}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}1827${iban.slice(2, 4)}`; // I=18, R=27, then the two check digits
  let rest = 0;
  for (const ch of rearranged) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

/** «IR••••…••1234»: only the last four digits (for the customer, lists and logs; never the whole number) */
export const maskIban = (iban: string): string => `IR${'•'.repeat(20)}${iban.slice(-4)}`;
