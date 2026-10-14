/** Any SMS gateway the shop can use. Providers throw AppError('SMS_FAILED') on failure. */
export interface SmsProvider {
  readonly name: string;
  /** Sends a one-time login code. `phone` is canonical 09XXXXXXXXX. */
  sendOtp(phone: string, code: string): Promise<void>;
}
