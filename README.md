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

## Telegram alerts
1. Create a bot with @BotFather and put its token in `TELEGRAM_BOT_TOKEN`.
2. Send the bot a message, open `https://api.telegram.org/bot<TOKEN>/getUpdates`, and put `chat.id` in `TELEGRAM_CHAT_ID`.
3. **api.telegram.org is filtered in Iran.** Either set `TELEGRAM_PROXY=http://127.0.0.1:<port>` (the local HTTP port of v2rayN, Clash, etc.) or use your own relay via `TELEGRAM_API_BASE`.
4. `npm run notify:test` sends a test message.

An alert is sent in these cases. Each message includes the time, duration, products fetched, products written and products rejected.

| Situation | Exit code | `failure_kind` | Example message |
|---|---|---|---|
| Some products rejected by the price check | 2 | – | `• 547 پرفیوم...: price jumped 67% (9770000 -> 3200000)` |
| A field read from a fallback path | 2 | – | `price از مسیر جایگزین «price»` |
| Page structure changed, run stopped | 1 | `structure` | `فیلد قیمت پیدا نشد در صفحه‌ی 3، محصول 547 (مسیرهای امتحان‌شده: ...)` |
| Fewer than 90% of products fetched | 1 | `coverage` | `فقط 150 از 226 محصول دریافت شد` |
| Token expired and automatic re-login failed | 1 | `auth` | `لاگین دستی لازم است (npm run login)` |
| Database down | 1 | `database` | `اتصال به Postgres برقرار نشد (ECONNREFUSED)` |
| Any other error | 1 | `error` | The error message |

All alerts are also written to `logs/alerts.log`. If Telegram is unreachable, the sync result is unaffected and only a warning is logged.

## How it works
- **Fetching:** pages through `GET /categories?page=N&_rsc` with the `RSC: 1` header (19 products per page, ~12 pages), waiting 1–3 s between requests.
- **Field paths:** each field is read from a list of candidate paths, defined in `FIELD_PATHS` in `src/normalize.mjs`.
  - If the primary path is missing, the fallbacks are tried and their use triggers an alert.
  - If no path exists, the run stops with `StructureError` and nothing is written.
- **Session:** logged-out responses have `pricing: null`. The sync treats them as an expired session, logs in again once and retries.
- **Prices:** integers in RIAL. `price` is the selling price. `cost_price` is `payable_price`, for internal use only.
- **Excluded categories:** products in `excludedCategories` (`src/config.mjs`) are stored with `is_sellable=false` and left out of `products.json`. `sellableOverrides` keeps individual products sellable.
- **Per-product sanity check:** if the price or cost is zero or empty, jumps more than 50%, or the stock is invalid, that product keeps its old values.
- **Run history:** the `sync_runs` table stores `started_at`, `status` (ok / warning / failed), `fetched`, `written`, `sellable`, `rejected`, `duration_ms`, `failure_kind` and `message`.

```sql
SELECT started_at, status, fetched, rejected, duration_ms, failure_kind FROM sync_runs ORDER BY id DESC LIMIT 20;
```
