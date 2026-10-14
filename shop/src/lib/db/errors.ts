import { AppError } from '@/lib/errors';

/** Postgres SQLSTATE / Node socket codes → one clean AppError. Raw driver errors never leave the db layer. */
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  '28P01', // invalid password
  '28000', // invalid authorization
  '3D000', // database does not exist
  '53300', // too many connections
  '57P01', // admin shutdown
  '57P02', // crash shutdown
  '57P03', // cannot connect now
]);

function codeOf(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string') return e.code;
  // pg wraps multi-address connect failures (IPv4 + IPv6) in an AggregateError with an empty message.
  if (e instanceof AggregateError) return e.errors.map(codeOf).find(Boolean);
  return undefined;
}

export function mapDbError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const code = codeOf(e);
  const msg = e instanceof Error ? e.message : '';

  if (code === '23505') return new AppError('CONFLICT', { cause: e });
  if (code === '23503') return new AppError('INVALID_REFERENCE', { cause: e });
  if (code === '23514' || code === '23502' || code === '22P02')
    return new AppError('INVALID_DATA', { cause: e });
  if (code === '57014') return new AppError('DB_TIMEOUT', { cause: e }); // statement_timeout
  if (
    (code && (CONNECTION_CODES.has(code) || code.startsWith('08'))) ||
    /timeout exceeded when trying to connect|Connection terminated/i.test(msg)
  ) {
    return new AppError('DB_UNAVAILABLE', { cause: e });
  }
  return new AppError('INTERNAL', { cause: e });
}
