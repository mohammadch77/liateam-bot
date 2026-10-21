import 'server-only';
import { z } from 'zod';
import { AppError } from '@/lib/errors';

/** "1" / "true" / "0" / "false" → boolean */
const bool = z.enum(['1', '0', 'true', 'false']).transform((v) => v === '1' || v === 'true');

/**
 * Environment contract. Every variable the server needs is declared here; nothing else reads process.env.
 * Loaded once at startup (src/instrumentation.ts) so a missing or invalid value stops the app immediately
 * with a readable list instead of failing later on the first request.
 */
const schema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']),
  PORT: z.coerce.number().int().min(1024).max(65535),
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => /^postgres(ql)?:\/\//.test(u), 'must start with postgres://'),
  /** Schema that holds the shop's own tables; separate per environment so staging never touches production data. */
  DB_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/, 'lowercase identifier, e.g. shop_staging'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ── Brand (never hard-coded; the name is still undecided) ──
  BRAND_NAME: z.string().trim().min(1).max(40),
  BRAND_LATIN: z.string().trim().max(40).default(''),
  SUPPORT_PHONE: z.string().trim().max(20).default(''),

  // ── Auth ──
  /** Server secret for the HMAC of OTP codes (a leaked database cannot be brute-forced offline). */
  AUTH_SECRET: z.string().min(32, 'at least 32 characters, e.g. `openssl rand -hex 32`'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Secure cookies (HTTPS). Only plain-http local development may turn this off. */
  COOKIE_SECURE: bool.default(true),
  /** Behind nginx: take the client IP from X-Real-IP. Never enable without a proxy that sets it. */
  TRUST_PROXY: bool.default(false),

  /**
   * Shared secret of POST /api/internal/revalidate (the sync bot asks the shop to drop cached pages of changed
   * products). Empty = the endpoint is off (404).
   */
  REVALIDATE_SECRET: z.string().min(32, 'at least 32 characters, e.g. `openssl rand -hex 32`').optional(),

  // ── Discounts (percent; the arithmetic with the purchase price runs in the database, never here) ──
  /** Liateam's discount to our account up to this percent is our margin; only the rest passes to the customer. */
  OUR_BASE_MARGIN_PERCENT: z.coerce.number().min(0).max(50).default(4),
  /** The customer's total discount (passed-through + ours) never exceeds this. */
  DISCOUNT_MAX_PERCENT: z.coerce.number().min(0).max(90).default(30),
  /** No discount takes the price under the purchase price plus this margin. */
  DISCOUNT_MIN_MARGIN_PERCENT: z.coerce.number().min(0).max(50).default(0),

  // ── SMS ──
  SMS_PROVIDER: z.enum(['dev', 'kavenegar']).default('dev'),
  KAVENEGAR_API_KEY: z.string().trim().optional(),
  /** Kavenegar «verify/lookup» template whose %token is the code. */
  KAVENEGAR_OTP_TEMPLATE: z.string().trim().optional(),
});

export type Config = Readonly<z.infer<typeof schema>>;

let cached: Config | undefined;

/** Rules that involve more than one variable. Returns the problems (names and rules only, never values). */
function crossCheck(c: z.infer<typeof schema>): string[] {
  const problems: string[] = [];
  if (c.APP_ENV === 'staging' && !c.DB_SCHEMA.endsWith('_staging')) {
    problems.push('DB_SCHEMA: staging must use a *_staging schema');
  }
  if (c.APP_ENV === 'production' && c.SMS_PROVIDER === 'dev') {
    problems.push('SMS_PROVIDER: "dev" only prints codes to the log and is refused in production');
  }
  if (c.APP_ENV === 'production' && !c.COOKIE_SECURE) {
    problems.push('COOKIE_SECURE: must be on in production');
  }
  if (c.SMS_PROVIDER === 'kavenegar' && (!c.KAVENEGAR_API_KEY || !c.KAVENEGAR_OTP_TEMPLATE)) {
    problems.push('KAVENEGAR_API_KEY / KAVENEGAR_OTP_TEMPLATE: required when SMS_PROVIDER=kavenegar');
  }
  return problems;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  const problems = parsed.success
    ? crossCheck(parsed.data)
    : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  if (!parsed.success || problems.length) {
    throw new AppError('CONFIG_INVALID', {
      message: `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\nSee .env.example and README.md.`,
    });
  }
  return Object.freeze(parsed.data);
}

export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}
