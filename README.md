# liateam-sync

Syncs supplier prices and stock from liateam.ir into `products.json` and a local Postgres database. It runs every 4 hours and sends a Telegram alert when something goes wrong.

**Shop (phase 1):**

- Server deployment runbook, every step in order: [`shop/README.md` → «استقرار (رانبوک)»](shop/README.md).
- Acceptance checklist: [`docs/phase1-acceptance-checklist.md`](docs/phase1-acceptance-checklist.md).
- Client handover: [`docs/phase1-handover.md`](docs/phase1-handover.md).

## Setup
1. `cp .env.example .env`, then fill in `LIA_USERNAME`, `LIA_PASSWORD` and the Telegram settings below.
2. Start Docker Desktop, then run `npm run db:up` (Postgres 16 on port 5433).
3. `npm run login`: logs in once and saves the session to `.auth/state.json`.
4. `npm run sync`: one manual run.

## Scheduling (Windows Task Scheduler)
| What | Command |
|---|---|
| Enable (every 4 h, first run 2 min later) | `npm run schedule:install` |
| Different interval | `powershell -ExecutionPolicy Bypass -File scripts/schedule.ps1 install -Hours 6` |
| Status (last run, result, next run) | `npm run schedule:status` |
| Pause / resume | `npm run schedule:disable` / `npm run schedule:enable` |
| Run now | `powershell -ExecutionPolicy Bypass -File scripts/schedule.ps1 run` |
| Remove completely | `npm run schedule:uninstall` |

- The task runs `run-sync.cmd` and writes its output to `logs/scheduler.log`.
- It runs only while you are logged into Windows, so no password is stored in the task. If the PC was off, the missed run starts as soon as it's back on (`StartWhenAvailable`).
- **Docker Desktop must be running.** Otherwise the run fails with a "database not reachable" alert.
- `LastResult` in the status output: `0` ok, `2` warning, `1` failed.

## Alerts and bots (Telegram / Bale)
`src/messenger.mjs` (service `liateam-messenger`) runs a Bale bot and/or a Telegram bot. Each is switched on/off separately in the dashboard (Settings → «ربات‌های تلگرام و بله»), and people join with a one-time invite code made there (role: admin or viewer).

- **Push notifications:** catalog changes after every run (price, stock, new/removed products; large price moves flagged as unusual), failed runs, warnings, recovery, and stale data. Each person picks their own topics in the bot.
- **In the bot:** status, last-24h changes, product search (photo, price, stock), low stock, personal notification settings. Admins also see cost and profit, can start a manual run and change the interval (3–24 h).
- **The bots never contact Liateam.** Every answer comes from the database. Manual runs go through the worker, which keeps at least `MIN_GAP_MINUTES` (20) between runs and skips scheduled runs during `QUIET_HOURS` (1–7 Tehran time).
- **Bale** works directly from Iran. **Telegram** needs `dashboard/deploy/cloudflare-telegram-relay.js` on a custom domain, then `TELEGRAM_API_BASE` in `.env`.

Failures are also written to `logs/alerts.log` and the `sync_alerts` table (dashboard → «اجراها و هشدار»).

## How it works
- **Fetching:** pages through `GET /categories?page=N&_rsc` with the `RSC: 1` header (19 products per page, ~12 pages), waiting 4–12 s between requests (sometimes 15–35 s), like a person reading.
- **Field paths:** each field is read from a list of candidate paths, defined in `FIELD_PATHS` in `src/normalize.mjs`.
  - If the primary path is missing, the fallbacks are tried and their use triggers an alert.
  - If no path exists, the run stops with `StructureError` and nothing is written.
- **Session:** logged-out responses have `pricing: null`. The sync treats them as an expired session, logs in again once and retries.
- **Prices:** integers in **TOMAN** — Liateam's own unit, stored unchanged (`SOURCE_PRICE_UNIT` in `src/normalize.mjs`). `price` is the selling price (the consumer price Liateam shows), `cost_price` is `payable_price`, for internal use only. Every display formats only, never divides by 10; only edges that need rial convert (e.g. schema.org `IRR`).
  - Until 2026-10-17 the system assumed rial and every price was shown 10× too low. Proof and guards: `explore/compare-prices.mjs` (raw value vs price displayed on Liateam), `test/price-unit.test.mjs` with known products, and in the shop `npm run check:prices`.
  - Sanity layers (`src/sanity.mjs`): per-product jump vs last value (`PRICE_JUMP_LIMIT`), plausible toman range (`PRICE_MIN_TOMAN` / `PRICE_MAX_TOMAN`, default 1,000–50,000,000) and cost/price ratio (`COST_RATIO_MIN` / `COST_RATIO_MAX`, 0.5–1.05) — refused products keep their old values; and a whole-catalog unit check (median new/old price ≥5 or ≤0.2 stops the run, nothing written, alert «💱»).
- **Excluded categories:** products in `excludedCategories` (`src/config.mjs`) are stored with `is_sellable=false` and left out of `products.json`. `sellableOverrides` keeps individual products sellable.
- **Per-product sanity check:** if the price or cost is zero or empty, jumps more than 50%, or the stock is invalid, that product keeps its old values.
- **Categories:** the category tree (code, name, parent) is read from the same `/categories` payload (no extra request) into the `categories` table. `product_catalog` joins names onto products; a category with no name shows as `#code`. `npm run probe:categories` lists what the payload carries.
- **Brand and description:** read from each product's own page (`/products/{code}?_rsc`, `src/product-details.mjs`), at most `DETAILS_PER_RUN` (default 30) pages per run with 6–18 s pauses; products never read come first, then each is re-read every `DETAILS_MAX_AGE_DAYS` (7). Pages the cross-check and audit already read are reused.
  - Field paths in `DETAIL_PATHS` (like `FIELD_PATHS`). A missing description is stored as empty and logged, never an error. If the product object is missing on most pages (layout change) an alert is raised and stored text is kept.
  - The description is stored as plain structured text (`## ` headings, `• ` list items); the supplier's HTML is never stored or rendered.
  - `brand` / `description` are written only when they changed (`details_updated_at`); `details_checked_at` only schedules the next visit. Price, stock and `updated_at` are never touched by this step.
  - The shop reads them through `product_catalog`; its roles need `shop/deploy/shop-db-roles-003-catalog-details.sql` once.
- **Rich product-page sections** (same page visit, same cadence; `parseRich` in `src/product-details.mjs`):
  - `summary` / `features[]`, specs → `product_attributes` (key/value, in order), `how_to_use`, video, FAQ → `product_faqs` (in order), the newest 10 reviews → `product_reviews` (+ `reviews_total`), `rating_value` (% of buyers who recommend it), `brand_code`.
  - The brand list (`product/brands`, carried by every page) is mirrored into `brands` like the category tree: Liateam order, `in_source=false` once dropped. Liateam has no Latin brand names, so `KNOWN_BRAND_LATIN` (`src/slug.mjs`) supplies them; a `latin_name` set by hand is kept.
  - Safety: everything is plain text through the same sanitiser as the description; video only from Liateam's ArvanCloud (mp4 URL / player URL, never iframe HTML); review authors are masked («مریم ا.») and phone numbers / e-mails in reviews removed. Nothing from the pricing block is read.
  - Change detection: one hash per section in `content_hashes`; a re-read rewrites only the sections whose hash changed. Pages never read for these sections are scheduled first.
  - English slug `slug_en` = brand Latin + transliterated name + code (`src/slug.mjs`), assigned once and never rewritten; `slug_fa` keeps the Persian slug of that moment for redirects.
  - Fill everything now instead of over the next runs: `npm run details:refresh -- --missing` (~12 s per product). Verify: `npm run check:rich` (`-- --live 10` reads 10 pages now). The shop's roles need `shop/deploy/shop-db-roles-005-rich-content.sql` once.
- **Shop search:** fuzzy search needs `shop/deploy/shop-db-004-search.sql` once, **as the database owner** (`sudo -u postgres psql lia_sync -f …`): `CREATE EXTENSION pg_trgm` needs that right. It adds `search_norm()` / `search_doc()` and a GIN trigram index on `supplier_products`; it changes no data. Until it has run, the shop falls back to plain substring search on names (logged once as `catalog.search_fallback`).
  - Matching: Arabic ي/ك, ZWNJ, آ/أ, Persian digits and harakat are folded the same way in SQL and in `shop/src/lib/search/normalize.ts`. Partial words match (`LIKE`, served by the index), longer words also by trigram similarity, and misspellings by edit distance against the catalog's own words («رمل» → «ریمل»). Results are ranked by match quality.
  - `npm run check:search` (in `shop/`) checks that both normalizers agree and that suggestions return only public fields.
- **Settings from the dashboard:** `excludedCategories`, `sellableOverrides` and `priceJumpLimit` in the `settings` table override `src/config.mjs`; the sync schedule lives in `sync_settings` (see «زمان‌بندی»).
- **Run history:** the `sync_runs` table stores `started_at`, `status` (ok / warning / failed), `fetched`, `written`, `sellable`, `rejected`, `duration_ms`, `failure_kind` and `message`.

```sql
SELECT started_at, status, fetched, rejected, duration_ms, failure_kind FROM sync_runs ORDER BY id DESC LIMIT 20;
```

---

# داشبورد (پوشه‌ی `dashboard/`)

داشبورد Next.js روی همان PostgreSQL ربات. فقط می‌خواند، به‌جز تنظیمات، گزارش تغییرات (audit) و درخواست اجرای دستی. صفحه‌ها: نمای کلی، محصولات، اجراها و هشدار، تنظیمات.

**پورت: `3847`، فقط روی `127.0.0.1`.** از بیرون فقط از راه nginx با HTTPS در دسترس است. اگر این پورت روی سرور گرفته است، `PORT` را در فایل سرویس عوض کنید و `proxy_pass` در nginx را هم مطابقش کنید. برای دیدن پورت‌های اشغال: `sudo ss -ltnp`.

## امنیت
- هیچ صفحه‌ای بدون لاگین باز نمی‌شود: `proxy.js` جلوی همه‌ی مسیرها (به‌جز `/login`) را می‌گیرد و هر صفحه و action دوباره سشن را چک می‌کند.
- لاگین تک‌کاربره است. رمز به‌صورت هش scrypt در `.env` ذخیره می‌شود. بعد از ۵ تلاش ناموفق، ورود برای ۱۵ دقیقه بسته می‌شود.
- کوکی سشن `httpOnly`، `Secure` و `SameSite=Strict` است و ۱۲ ساعت اعتبار دارد.
- داشبورد هیچ رازی نمی‌خواند و نشان نمی‌دهد. رمز لیاتیم و توکن تلگرام در `.env` ربات می‌مانند و داشبورد فقط «وضعیت» را از جدول `bot_status` می‌خواند.
- برای دیتابیس از نقش محدود `lia_dashboard` استفاده کنید.

## راه‌اندازی روی سرور (Linux)
```bash
# ۱) ربات (یک بار): نصب، .env، دیتابیس، لاگین، اولین اجرا
cd /opt/liateam-bot && npm install && cp .env.example .env   # .env را پر کنید
npm run db:up && npm run login && npm run sync

# ۲) نقش محدود دیتابیس برای داشبورد (رمز CHANGE_ME را در فایل عوض کنید)
docker compose exec -T postgres psql -U lia lia_sync < dashboard/deploy/dashboard-role.sql

# ۳) داشبورد
cd dashboard && npm install && cp .env.example .env
npm run hash-password -- 'یک رمز طولانی'   # خروجی را در .env بگذارید
openssl rand -hex 32                        # مقدار SESSION_SECRET
npm run build

# ۴) سرویس‌ها (مسیر و User را در فایل‌ها با سرور خودتان تطبیق دهید)
sudo cp deploy/liateam-dashboard.service deploy/liateam-worker.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now liateam-dashboard liateam-worker

# ۵) nginx + HTTPS
sudo cp deploy/nginx-liateam-dashboard.conf /etc/nginx/sites-available/liateam-dashboard
# داخل فایل، server_name را عوض کنید و فایل را در sites-enabled لینک کنید
sudo certbot --nginx -d dash.example.com && sudo nginx -t && sudo systemctl reload nginx
```
بعد از هر به‌روزرسانی کد: `cd dashboard && npm install && npm run build && sudo systemctl restart liateam-dashboard`

## زمان‌بندی: worker (پنجره‌ای)
`npm run worker` (یا سرویس `liateam-worker`) هر ۳۰ ثانیه جدول `sync_schedule` را نگاه می‌کند و هر وظیفه‌ای را که وقتش رسیده با `src/sync.mjs` اجرا می‌کند. دکمه‌ی «اجرای دستی» داشبورد و ربات‌ها هم ظرف ۳۰ ثانیه انجام می‌شود (همه‌ی وظایف، بیرون از پنجره هم).
**worker و Task Scheduler ویندوز را با هم روشن نکنید.** اگر worker روشن است، `npm run schedule:disable` بزنید.

**وظیفه‌ها:**
- `catalog`: قیمت و موجودی، از صفحه‌های فهرست (۱۲ صفحه، نه تک‌تک محصولات)، به‌اضافه‌ی بررسی دوطرفه‌ی روزانه
- `hero`: بنرهای صفحه‌ی اصلی (۱ صفحه)
- `details`: محتوای سنگین (توضیحات، مشخصات، عکس، ویدیو، پرسش‌ها، نظرات)، برای محصول‌هایی که یک هفته از آخرین خواندنشان گذشته یا نامشان/عکسشان در فهرست عوض شده یا تازه آمده‌اند، به‌اضافه‌ی چک عکس‌ها

**پنجره‌های پیش‌فرض (به وقت تهران):**

| پنجره | ساعت | `catalog` | `hero` | `details` |
|---|---|---|---|---|
| روز (`day`) | ۰۷:۰۰ تا ۱۹:۰۰ | هر ~۶۰ دقیقه | هر ~۳۰ دقیقه | هر ~۱۸۰ دقیقه |
| عصر (`evening`) | ۱۹:۰۰ تا ۲۳:۰۰ | هر ~۲۴۰ دقیقه | هر ~۳۰ دقیقه | هر ~۱۸۰ دقیقه |
| شب (`night`) | ۲۳:۰۰ تا ۰۷:۰۰ | خواب | خواب | خواب |

- هر فاصله تصادفی **±۲۰٪** جابه‌جا می‌شود (۶۰ ← بین ۴۸ و ۷۲) و هیچ اجرایی دقیقاً سر ساعت گرد شروع نمی‌شود.
- اجرایی که در شب بیفتد به **۰۷:۰۰ + ۱ تا ۱۵ دقیقه‌ی تصادفی** صبح بعد منتقل می‌شود. شب هیچ درخواستی به لیاتیم نمی‌رود.
- زمان اجرای بعدی هر وظیفه بعد از هر اجرا در `sync_schedule` ذخیره می‌شود؛ ری‌استارت سرویس الگو را به هم نمی‌زند.
- داخل هر اجرا: مکث ۱ تا ۳ ثانیه‌ی تصادفی بین درخواست‌ها، و حداکثر `MAX_REQUESTS_PER_RUN` درخواست (پیش‌فرض ۶۰؛ صفحه‌های فهرست همیشه کامل خوانده می‌شوند، بقیه در اجرای بعد ادامه می‌یابد).
- بین هر دو اجرا (دستی هم) حداقل `MIN_GAP_MINUTES` (پیش‌فرض ۲۰) دقیقه فاصله است.

**تنظیمات:** پیش‌فرض‌های `src/scheduler.mjs` ← متغیرهای `.env` ← جدول `sync_settings` (اولویت با جدول؛ کلید/مقدار JSON). کلید ناشناخته یا مقدار نامعتبر نادیده گرفته می‌شود و در لاگ worker می‌آید.

**تغییر از پنل یا ربات (هر دو یکی‌اند):**
- **داشبورد ← تنظیمات ← «زمان‌بندی همگام‌سازی»:**
  - وضعیت (پنجره‌ی فعلی، فعال/متوقف/عقب‌نشینی)
  - **اجرای قبلی و بعدی** هر وظیفه (از `sync_schedule`)
  - **پنجره‌ها:** روز از … تا …، عصر تا …؛ شب بقیه‌ی ساعت‌هاست، همیشه خواب و حذف‌نشدنی
  - **فاصله‌ی پایه‌ی هر وظیفه در هر پنجره** (قیمت و موجودی، بنرها، محتوای سنگین × روز، عصر)، به دقیقه
  - دکمه‌ی توقف موقت / ادامه
- **داشبورد ← «بنرها»:** بنرهای فعلی، بررسی‌ها، تغییرها و فاصله‌ی بنرها (برای روز و عصر با هم).
- **ربات بله/تلگرام ← «⏱ زمان‌بندی»:** فاصله‌ها با گزینه‌های آماده (بنرها و محتوای سنگین برای روز و عصر با هم) و توقف موقت.

هر سه همان ردیف‌های `sync_settings` را می‌نویسند و در گزارش تغییرات (چه کسی، چه چیزی، قبل و بعد) ثبت می‌کنند، پس همیشه همگام‌اند. worker ظرف ۳۰ ثانیه تنظیم جدید را اعمال می‌کند. یک بار لازم است: `sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role-schedule.sql`.

**قواعد ایمنی** (`src/schedule-rules.mjs`، با یک نسخه‌ی یکسان در `dashboard/lib/scheduleRules.mjs`؛ تست بررسی می‌کند که دو نسخه یکی بمانند). پنل و ربات قبل از ذخیره همین قواعد را چک می‌کنند و مقدار نامعتبر را با پیام فارسی رد می‌کنند؛ خود ربات هم هنگام خواندن، مقدار نامعتبر را نادیده می‌گیرد.
- **حداقل فاصله‌ها:** قیمت و موجودی ۳۰، بنرها ۱۵، محتوای سنگین ۶۰ دقیقه؛ حداکثر ۲۴ ساعت. قابل تغییر با `SYNC_MIN_CATALOG_MINUTES`، `SYNC_MIN_HERO_MINUTES` و `SYNC_MIN_DETAILS_MINUTES`، با **همان نام در `.env` ربات و `.env` داشبورد**. فاصله‌ی خیلی کم ممکن است باعث مسدود شدن حساب شما در لیاتیم شود.
- **پنجره‌ها:** به ترتیب روز ← عصر ← شب، بدون هم‌پوشانی و بدون فاصله. روز و عصر هر کدام حداقل ۳۰ دقیقه، و خواب شبانه حداقل ۶۰ دقیقه (حذف نمی‌شود).

فیلد قدیمی «فاصله‌ی اجرا (ساعت)» (`intervalHours`) از پنل و کد حذف شد و ردیف قدیمی‌اش هنگام اجرای ربات خودبه‌خود از جدول `settings` پاک می‌شود.

**عقب‌نشینی (backoff):** اگر لیاتیم `BACKOFF_THRESHOLD` بار (پیش‌فرض ۳) پشت‌سرِ هم با ۴۲۹، ۴۰۳، ۵xx یا صفحه‌ی کپچا/چالش جواب بدهد، اجرا همان لحظه متوقف می‌شود و **همه‌ی وظایف** ۳۰ دقیقه صبر می‌کنند. اگر بلافاصله دوباره تکرار شد، ۶۰، بعد ۱۲۰ و سپس حداکثر ۲۴۰ دقیقه. با اولین پاسخ عادی همه‌چیز صفر می‌شود. وضعیت در `bot_status` (کلید `backoff`) است و `npm run sync:schedule` آن را نشان می‌دهد. در این مدت اجرای دستی هم در صف می‌ماند. برای عبور اضطراری: `npm run sync:run -- --force --ignore-backoff`.

**دستورها:**
- `npm run sync:schedule`: پنجره‌ی فعلی، توقف یا نه، و آخرین/بعدی هر وظیفه
- `npm run sync:schedule -- --simulate 24`: اجراهای ۲۴ ساعت آینده (با jitter تصادفی)
- `npm run sync:run`: همین الان، وظیفه‌هایی که پنجره‌ی فعلی اجازه می‌دهد (شب: هیچ‌کدام)
- `npm run sync:run -- --force`: همه‌ی وظیفه‌ها، بیرون از پنجره و در حالت توقف هم، با همان مکث‌ها و همان سقف
- `npm run sync:run -- --tasks=catalog,hero`: فقط این وظیفه‌ها


## رویدادهای تغییر (`change_events`)
هر تغییر واقعی که ربات می‌نویسد، **در همان تراکنش**، یک ردیف در `change_events` هم می‌سازد: تغییر قیمت فروش، موجودی، محصول جدید/حذف‌شده/برگشته، تغییر نام، توضیحات، ویژگی‌ها، مشخصات، نحوه‌ی مصرف، ویدیو، پرسش‌ها، نظرات، گالری، عکس اصلی، حجم/ماندگاری، «مناسب برای»، بنرها، و شروع/پایان عقب‌نشینی (`sync_backoff`).
- بخشی که برای اولین بار پر می‌شود «تغییر» حساب نمی‌شود. امتیاز و تگ‌ها هم که مدام جابه‌جا می‌شوند رویداد نمی‌سازند.
- **قیمت خرید (`cost_price`) هرگز در رویداد، پیام ربات یا خروجی `events:list` نمی‌آید.** تغییرِ فقط قیمت خرید اصلاً رویداد نمی‌سازد.
- **اعلام:** سرویس `liateam-messenger` ردیف‌های اعلام‌نشده را (۲ دقیقه بعد از ثبت، تا تغییرات یک اجرا با هم برسند) **تجمیعی** در یک پیام می‌فرستد، مثلاً «۵ تغییر قیمت · ۲ تغییر توضیحات» با فهرست کوتاه هر نوع. حداکثر `NOTIFY_MAX_PER_HOUR` پیام در ساعت (پیش‌فرض ۶)؛ بیشتر از آن منتظر می‌ماند و در پیام بعدی جمع می‌شود. هر کس در ربات گروه‌های دلخواهش را روشن/خاموش می‌کند (قیمت، موجودی، محصول جدید/حذف‌شده، محتوا و بنرها، خطاها).
- **مشاهده:** داشبورد ← «تغییرات» ← «همه‌ی رویدادها» (یک بار: `sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role-events.sql`)، یا `npm run events:list` (`npm run events:list -- 200 price_changed`).

## به‌روز شدن فوری صفحه‌های فروشگاه
بعد از هر اجرایی که تغییری نوشت (و بعد از commit آن)، ربات از فروشگاه می‌خواهد صفحه‌هایی را که آن تغییر را نشان می‌دهند از کش بیرون بیندازد:
- صفحه‌ی هر محصول تغییرکرده
- برای تغییر قیمت، موجودی، محصول جدید/حذف‌شده یا عکس: صفحه‌ی اصلی، `/shop`، جست‌وجو و همه‌ی صفحه‌های دسته و برند
- برای تغییر بنرها: صفحه‌ی اصلی

ربات `POST /api/internal/revalidate` فروشگاه را با هدر `x-revalidate-secret` صدا می‌زند. اگر شکست بخورد، تا ۳ بار (با فاصله‌ی ۱ و ۲ ثانیه) دوباره تلاش می‌کند و بعد فقط لاگ می‌کند؛ هیچ‌وقت همگام‌سازی را خراب نمی‌کند.

راه‌اندازی (اختیاری؛ بدون آن خاموش است):
- `.env` ربات: `SHOP_REVALIDATE_URL=http://127.0.0.1:<پورت فروشگاه>/api/internal/revalidate` و `SHOP_REVALIDATE_SECRET=<۶۴ کاراکتر>`
- `.env` فروشگاه: `REVALIDATE_SECRET=<همان مقدار>`

بدون secret درست، endpoint پاسخ ۴۰۱ می‌دهد (و اگر در فروشگاه تنظیم نشده باشد، ۴۰۴).

## اجرای محلی (بدون HTTPS)
در `dashboard/.env` مقدار `COOKIE_SECURE=0` را بگذارید، سپس `npm run build && npm start` و آدرس http://127.0.0.1:3847 را باز کنید.

## ربات‌های بله و تلگرام
۱. **ساخت ربات بله:** در پیام‌رسان بله، `@BotFather` را باز کنید، یک ربات بسازید و توکنش را در `.env` سرور بگذارید: `BALE_BOT_TOKEN=...`
۲. **تلگرام (اختیاری):** همین کار را در تلگرام انجام دهید (`TELEGRAM_BOT_TOKEN`). چون تلگرام در ایران فیلتر است، فایل `dashboard/deploy/cloudflare-telegram-relay.js` را روی یک دامنه‌ی Cloudflare بگذارید و `TELEGRAM_API_BASE` را تنظیم کنید. راهنمای کامل بالای همان فایل است.
۳. سرویس را روشن کنید: `sudo cp dashboard/deploy/liateam-messenger.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now liateam-messenger`
۴. دسترسی داشبورد به جدول کاربران ربات: `sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role-messenger.sql`
۵. در داشبورد → تنظیمات → «ربات‌های تلگرام و بله»: ربات را روشن کنید، «ساخت کد دعوت» را بزنید و کد را برای ربات بفرستید.

ربات‌ها هیچ‌وقت به لیاتیم درخواست نمی‌فرستند و همه‌ی جواب‌ها از دیتابیس است. اجرای خودکار شب‌ها (۲۳:۰۰ تا ۰۷:۰۰) انجام نمی‌شود (بخش «زمان‌بندی»)، و بین هر دو اجرا (حتی دستی) حداقل ۲۰ دقیقه فاصله است.

## سفارش‌ها (سرویس `liateam-orders`)
روند: مشتری سبد می‌سازد ← **مرور سفارش** (موجودی و قیمت همان لحظه از لیاتیم) ← پرداخت در سایت ما ← سفارش در **صف ثبت** ←
مدیر در بله/تلگرام یا داشبورد «ثبت و پرداخت» را می‌زند ← ربات همان لحظه دوباره بررسی می‌کند، آدرس مشتری را در لیاتیم می‌سازد،
سفارش را ثبت می‌کند و **لینک پرداخت** را می‌فرستد ← بعد از پرداخت، وضعیت (پرداخت/ارسال) خودکار دنبال می‌شود و آدرس مشتری حذف می‌شود.

- لیاتیم سفارش پرداخت‌نشده را حدود ۲۰ دقیقه بعد لغو می‌کند؛ برای همین سفارش فقط وقتی مدیر آماده‌ی پرداخت است ثبت می‌شود.
  اگر لغو شد، سفارش خودکار به صف برمی‌گردد. سفارشی که بیش از ۲ ساعت در صف بماند (بیرون از ساعت‌های سکوت) یادآوری می‌شود.
- قلمی که هنگام ثبت ناموجود شده باشد ثبت نمی‌شود و مبلغش به **کیف پول** مشتری برمی‌گردد (فعلاً کیف پول شبیه‌سازی‌شده: `wallet_ledger`).
- قیمتی که در مرور یا ثبت عوض شده باشد از همان لحظه در کاتالوگ اعمال و به مدیر خبر داده می‌شود.
- موجودی هیچ‌وقت زودتر از تمام شدن واقعی «ناموجود» نمی‌شود؛ تعداد سفارش‌های در صف و تعدادهای **قفل‌شده در مرور سفارش**<br>(مثل رزرو بلیط سینما: ۱۵ دقیقه برای همان مشتری، جدول `review_holds`) از موجودی کم می‌شود. این قفل فقط در سیستم ماست، نه در لیاتیم.
  و موجودی ≤ `limitedStock` (پیش‌فرض ۵) «موجودی محدود» است و سفارشش ⚡️ فوری علامت می‌خورد.
- **حالت آزمایشی** (`ordersDryRun`، پیش‌فرض روشن): همه‌ی مراحل جز `POST /order/orders` اجرا می‌شود و آدرس ساخته‌شده دوباره حذف می‌شود.
  کلیدش در داشبورد ← سفارش‌ها است.
- اگر خطا بعد از ارسال درخواست ثبت سفارش رخ دهد، سفارش **خودکار دوباره ثبت نمی‌شود** (جلوی سفارش تکراری) و به مدیر خبر داده می‌شود.
- لینک پرداخت را خود لیاتیم در پاسخ ثبت سفارش می‌دهد (`data.link`) و بدون لاگین لیاتیم مستقیم به درگاه می‌رود؛ پس روی گوشی مدیر باز می‌شود.
- پرداخت به لیاتیم خودکار نیست: لیاتیم کیف پول ندارد و درگاه بانکی رمز پویا می‌خواهد.

API آزمایشی (پشت لاگین داشبورد؛ سایت NestJS بعداً همین‌ها را صدا می‌زند) و صفحه‌ی `/orders` برای تست دستی:

| API | کار |
|---|---|
| `GET /api/test/geo[?province_id=11]` | استان‌ها / شهرهای لیاتیم |
| `POST /api/test/review` `{"city_id":208,"items":[{"product_id":544,"quantity":1}]}` | مرور سفارش؛ `job_id` پاسخ = شناسه‌ی مرور (۱۵ دقیقه، یک‌بار مصرف) |
| `POST /api/test/orders` `{"review_id":…,"payment":"gateway"\|"wallet","customer":{…},"address":{…}}` | ثبت سفارش در صف |
| `POST /api/test/topup` `{"mobile":"09…","amount":500000}` | شارژ آزمایشی کیف پول (تومان) |

راه‌اندازی روی سرور (فقط پوشه‌ی ربات و سرویس‌های `liateam-*`):
```bash
cd /opt/liateam-bot/app && sudo -u liateam git pull --ff-only
sudo cp dashboard/deploy/liateam-orders.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now liateam-orders            # جدول‌ها را می‌سازد
sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role-orders.sql
cd dashboard && sudo -u liateam npm run build && sudo systemctl restart liateam-dashboard liateam-messenger
```
