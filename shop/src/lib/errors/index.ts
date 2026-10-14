/** Stable error codes the UI and API can branch on. */
export type ErrorCode =
  | 'CONFLICT'
  | 'INVALID_REFERENCE'
  | 'INVALID_DATA'
  | 'NOT_FOUND'
  | 'DB_UNAVAILABLE'
  | 'DB_TIMEOUT'
  | 'CONFIG_INVALID'
  | 'INTERNAL';

const DEFAULTS: Record<ErrorCode, { message: string; status: number }> = {
  CONFLICT: { message: 'این مورد قبلاً ثبت شده است.', status: 409 },
  INVALID_REFERENCE: { message: 'اطلاعات مرتبط پیدا نشد یا حذف شده است.', status: 422 },
  INVALID_DATA: { message: 'اطلاعات واردشده معتبر نیست.', status: 422 },
  NOT_FOUND: { message: 'موردی پیدا نشد.', status: 404 },
  DB_UNAVAILABLE: { message: 'سرویس موقتاً در دسترس نیست. چند لحظه بعد دوباره تلاش کنید.', status: 503 },
  DB_TIMEOUT: { message: 'پاسخ‌گویی طول کشید. دوباره تلاش کنید.', status: 504 },
  CONFIG_INVALID: { message: 'پیکربندی سرور ناقص است.', status: 500 },
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
