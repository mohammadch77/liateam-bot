import 'server-only';
import { z } from 'zod';
import { AppError } from '@/lib/errors';

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
});

export type Config = Readonly<z.infer<typeof schema>>;

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Names and rules only — never echo the values (they may be secrets).
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new AppError('CONFIG_INVALID', {
      message: `Invalid environment configuration:\n${problems}\nSee .env.example and README.md.`,
    });
  }
  if (parsed.data.APP_ENV === 'staging' && !parsed.data.DB_SCHEMA.endsWith('_staging')) {
    throw new AppError('CONFIG_INVALID', {
      message: 'Invalid environment configuration:\n  - DB_SCHEMA: staging must use a *_staging schema',
    });
  }
  return Object.freeze(parsed.data);
}

export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}
