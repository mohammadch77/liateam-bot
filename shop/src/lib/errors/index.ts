/** Stable error codes the UI and API can branch on. */
export type ErrorCode =
  | 'CONFLICT'
  | 'INVALID_REFERENCE'
  | 'INVALID_DATA'
  | 'NOT_FOUND'
  | 'DB_UNAVAILABLE'
  | 'DB_TIMEOUT'
  | 'CONFIG_INVALID'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INVALID_CODE'
  | 'LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'SMS_FAILED'
  | 'CSRF'
  | 'DISCOUNT_UNSAFE'
  | 'INTERNAL';

const DEFAULTS: Record<ErrorCode, { message: string; status: number }> = {
  CONFLICT: { message: 'این مورد قبلاً ثبت شده است.', status: 409 },
  INVALID_REFERENCE: { message: 'اطلاعات مرتبط پیدا نشد یا حذف شده است.', status: 422 },
  INVALID_DATA: { message: 'اطلاعات واردشده معتبر نیست.', status: 422 },
  NOT_FOUND: { message: 'موردی پیدا نشد.', status: 404 },
  DB_UNAVAILABLE: { message: 'سرویس موقتاً در دسترس نیست. چند لحظه بعد دوباره تلاش کنید.', status: 503 },
  DB_TIMEOUT: { message: 'پاسخ‌گویی طول کشید. دوباره تلاش کنید.', status: 504 },
  CONFIG_INVALID: { message: 'پیکربندی سرور ناقص است.', status: 500 },
  UNAUTHORIZED: { message: 'برای ادامه وارد حساب کاربری شوید.', status: 401 },
  FORBIDDEN: { message: 'به این بخش دسترسی ندارید.', status: 403 },
  // Deliberately vague: never reveals whether a number is registered or which limit was hit.
  RATE_LIMITED: { message: 'درخواست‌ها بیش از حد مجاز است. چند دقیقه بعد دوباره تلاش کنید.', status: 429 },
  INVALID_CODE: { message: 'کد واردشده نادرست یا منقضی است.', status: 400 },
  LOCKED: { message: 'تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.', status: 429 },
  ACCOUNT_DISABLED: { message: 'این حساب غیرفعال است. با پشتیبانی تماس بگیرید.', status: 403 },
  SMS_FAILED: { message: 'ارسال پیامک انجام نشد. چند لحظه بعد دوباره تلاش کنید.', status: 502 },
  CSRF: { message: 'درخواست نامعتبر است. صفحه را دوباره باز کنید.', status: 403 },
  // never with a number: the limit comes from the purchase price
  DISCOUNT_UNSAFE: { message: 'تخفیف بیش از حد مجاز است.', status: 422 },
  INTERNAL: { message: 'خطای غیرمنتظره‌ای رخ داد. دوباره تلاش کنید.', status: 500 },
};

/**
 * An error that is safe to show: `message` is user-facing Persian text, never SQL or stack details.
 * The original error stays in `cause` for logs only.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, options: { message?: string; status?: number; cause?: unknown } = {}) {
    const d = DEFAULTS[code];
    super(options.message ?? d.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? d.status;
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/** Anything thrown → AppError (unknown errors become INTERNAL). */
export const toAppError = (e: unknown): AppError =>
  isAppError(e) ? e : new AppError('INTERNAL', { cause: e });
