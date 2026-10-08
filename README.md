# liateam-sync

Syncs supplier prices and stock from liateam.ir into `products.json` and a local Postgres database. It runs every 4 hours and sends a Telegram alert when something goes wrong.

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
- **Fetching:** pages through `GET /categories?page=N&_rsc` with the `RSC: 1` header (19 products per page, ~12 pages), waiting 2–5 s between requests.
- **Field paths:** each field is read from a list of candidate paths, defined in `FIELD_PATHS` in `src/normalize.mjs`.
  - If the primary path is missing, the fallbacks are tried and their use triggers an alert.
  - If no path exists, the run stops with `StructureError` and nothing is written.
- **Session:** logged-out responses have `pricing: null`. The sync treats them as an expired session, logs in again once and retries.
- **Prices:** integers in RIAL. `price` is the selling price. `cost_price` is `payable_price`, for internal use only.
- **Excluded categories:** products in `excludedCategories` (`src/config.mjs`) are stored with `is_sellable=false` and left out of `products.json`. `sellableOverrides` keeps individual products sellable.
- **Per-product sanity check:** if the price or cost is zero or empty, jumps more than 50%, or the stock is invalid, that product keeps its old values.
- **Categories:** the category tree (code, name, parent) is read from the same `/categories` payload (no extra request) into the `categories` table. `product_catalog` joins names onto products; a category with no name shows as `#code`. `npm run probe:categories` lists what the payload carries.
- **Settings from the dashboard:** `excludedCategories`, `sellableOverrides`, `priceJumpLimit` and `intervalHours` in the `settings` table override `src/config.mjs`.
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

## زمان‌بندی: worker
`npm run worker` (یا سرویس `liateam-worker`) هر `intervalHours` ساعت یک sync اجرا می‌کند و دکمه‌ی «اجرای دستی» داشبورد را هم ظرف ۳۰ ثانیه انجام می‌دهد. فاصله‌ی اجرا از صفحه‌ی تنظیمات عوض می‌شود.
**worker و Task Scheduler ویندوز را با هم روشن نکنید.** اگر worker روشن است، `npm run schedule:disable` بزنید. بدون worker، داشبورد کار می‌کند ولی «اجرای دستی» در صف می‌ماند و «اجرای بعدی» تخمینی نمایش داده می‌شود.

## اجرای محلی (بدون HTTPS)
در `dashboard/.env` مقدار `COOKIE_SECURE=0` را بگذارید، سپس `npm run build && npm start` و آدرس http://127.0.0.1:3847 را باز کنید.

## ربات‌های بله و تلگرام
۱. **ساخت ربات بله:** در پیام‌رسان بله، `@BotFather` را باز کنید، یک ربات بسازید و توکنش را در `.env` سرور بگذارید: `BALE_BOT_TOKEN=...`
۲. **تلگرام (اختیاری):** همین کار را در تلگرام انجام دهید (`TELEGRAM_BOT_TOKEN`). چون تلگرام در ایران فیلتر است، فایل `dashboard/deploy/cloudflare-telegram-relay.js` را روی یک دامنه‌ی Cloudflare بگذارید و `TELEGRAM_API_BASE` را تنظیم کنید. راهنمای کامل بالای همان فایل است.
۳. سرویس را روشن کنید: `sudo cp dashboard/deploy/liateam-messenger.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now liateam-messenger`
۴. دسترسی داشبورد به جدول کاربران ربات: `sudo -u postgres psql lia_sync < dashboard/deploy/dashboard-role-messenger.sql`
۵. در داشبورد → تنظیمات → «ربات‌های تلگرام و بله»: ربات را روشن کنید، «ساخت کد دعوت» را بزنید و کد را برای ربات بفرستید.

ربات‌ها هیچ‌وقت به لیاتیم درخواست نمی‌فرستند و همه‌ی جواب‌ها از دیتابیس است. اجرای خودکار بین ساعت ۱ تا ۷ بامداد انجام نمی‌شود، و بین هر دو اجرا (حتی دستی) حداقل ۲۰ دقیقه فاصله است.
