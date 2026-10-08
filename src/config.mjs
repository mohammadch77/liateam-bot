import 'dotenv/config';

const env = process.env;

export const config = {
  username: env.LIA_USERNAME,
  password: env.LIA_PASSWORD,
  baseUrl: 'https://liateam.ir',
  signInUrl: 'https://liateam.ir/auth/sign-in',
  storageStatePath: '.auth/state.json',
  outputJson: env.OUTPUT_JSON || 'products.json',
  databaseUrl: env.DATABASE_URL || 'postgres://lia:lia@localhost:5433/lia_sync',
  delayMinMs: Number(env.DELAY_MIN_MS || 2000),
  delayMaxMs: Number(env.DELAY_MAX_MS || 5000),
  maxPages: Number(env.MAX_PAGES || 50), // hard stop against runaway pagination
  priceJumpLimit: Number(env.PRICE_JUMP_LIMIT || 0.5), // 50%
  minCoverage: Number(env.MIN_COVERAGE || 0.9), // fetched / reported total
  headful: env.LOGIN_HEADFUL === '1',
  // Products in these supplier categories are stored with is_sellable=false and left out of products.json.
  // 199 = «ابزارها و سمپل فروش» (bags, ribbons, brochures, testers, merch); 124 = unnamed subset of 199.
  excludedCategories: [199, 124],
  // Product codes that stay sellable even if they sit in an excluded category.
  sellableOverrides: [],
  // Hours between scheduled runs of src/worker.mjs. The settings table (dashboard) overrides all of the above.
  intervalHours: Number(env.SYNC_INTERVAL_HOURS || 4),
  // Messenger bots are switched on/off from the dashboard; tokens live only in .env.
  telegramEnabled: false,
  baleEnabled: false,
  // Behave like a person: no scheduled runs in these Tehran hours ("1-7" = 01:00–06:59), and
  // at least this many minutes between any two runs (manual ones included).
  quietHours: env.QUIET_HOURS ?? '1-7',
  minGapMinutes: Number(env.MIN_GAP_MINUTES || 20),
};

export function requireCredentials() {
  if (!config.username || !config.password) {
    throw new Error('LIA_USERNAME / LIA_PASSWORD missing in .env');
  }
}
