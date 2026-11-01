/** Iranian mobile numbers: the logic lives in phone.mjs (plain JS) so Node 20 server scripts can import it without a TS loader. */
export { digitsOnly, maskMobile, normalizeMobile, toLatinDigits } from './phone.mjs';
