export declare const toLatinDigits: (s: string) => string;
/** → '09121234567', or null when it is not an Iranian mobile number. */
export declare function normalizeMobile(input: string): string | null;
/** '09121234567' → '0912•••4567' */
export declare const maskMobile: (phone: string) => string;
export declare const digitsOnly: (s: string) => string;
