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
  // Pause before every request to Liateam (listing pages, product pages, home page): random between these.
  pauseMinMs: Number(env.REQUEST_PAUSE_MIN_MS || 1000),
  pauseMaxMs: Number(env.REQUEST_PAUSE_MAX_MS || 3000),
  // Requests to Liateam in one run: the listing pages always run (counted first); product pages and the home page
  // stop when the cap is reached and continue next run.
  maxRequestsPerRun: Number(env.MAX_REQUESTS_PER_RUN || 60),
  maxPages: Number(env.MAX_PAGES || 50), // hard stop against runaway pagination
  priceJumpLimit: Number(env.PRICE_JUMP_LIMIT || 0.5), // 50%
  minCoverage: Number(env.MIN_COVERAGE || 0.9), // fetched / reported total
  // Plausible price of one catalog item in TOMAN (sanity.mjs). Catalog on 2026-10-17: 5,300 (brochures) to
  // 9,770,000 (perfume). The max is low enough that the dearest product read as RIAL (97.7 million) is refused.
  priceRangeToman: { min: Number(env.PRICE_MIN_TOMAN || 1_000), max: Number(env.PRICE_MAX_TOMAN || 50_000_000) },
  // cost_price / price: Liateam's partner price is ≈0.96 of the consumer price.
  costRatio: { min: Number(env.COST_RATIO_MIN || 0.5), max: Number(env.COST_RATIO_MAX || 1.05) },
  // Brand + description from product pages: at most this many pages per run (each 6–18 s, like a person);
  // 30 per 4-hour run covers all ~230 products in about a day, then each is re-read once a week.
  detailsPerRun: Number(env.DETAILS_PER_RUN ?? 30),
  detailsMaxAgeDays: Number(env.DETAILS_MAX_AGE_DAYS || 7),
  // Photo checks on Liateam's image host (images.mjs): at most this many HEAD requests per run (0.8–2 s apart).
  imageChecksPerRun: Number(env.IMAGE_CHECKS_PER_RUN ?? 60),
  headful: env.LOGIN_HEADFUL === '1',
  // Products in these supplier categories are stored with is_sellable=false and left out of products.json.
  // 199 = «ابزارها و سمپل فروش» (bags, ribbons, brochures, testers, merch); 124 = unnamed subset of 199.
  excludedCategories: [199, 124],
  // Product codes that stay sellable even if they sit in an excluded category.
  sellableOverrides: [],
  // Legacy fixed interval (before the window schedule in scheduler.mjs); kept only for the dashboard/bots display.
  intervalHours: Number(env.SYNC_INTERVAL_HOURS || 4),
  // Messenger bots are switched on/off from the dashboard; tokens live only in .env.
  telegramEnabled: false,
  baleEnabled: false,
  // Order reminders stay silent in these Tehran hours ("1-7" = 01:00–06:59). The sync's own night sleep is the
  // window schedule (scheduler.mjs). At least minGapMinutes between any two sync runs (manual ones included).
  quietHours: env.QUIET_HOURS ?? '1-7',
  minGapMinutes: Number(env.MIN_GAP_MINUTES || 20),
  // Orders (src/orders.mjs). Dry run stays on until switched off in the dashboard.
  ordersDryRun: true,
  limitedStock: 5,
  // Liateam bank gateway used for supplier payments (id from GET /payment/payments); empty = first one.
  ordersPaymentId: env.ORDERS_PAYMENT_ID || '',
};

export function requireCredentials() {
  if (!config.username || !config.password) {
    throw new Error('LIA_USERNAME / LIA_PASSWORD missing in .env');
  }
}
