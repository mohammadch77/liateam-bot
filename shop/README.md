# liateam-shop

فروشگاه اینترنتی — Next.js (App Router) + TypeScript strict + PostgreSQL.
اپ جدا از ربات همگام‌ساز است ولی کاتالوگ محصولات را از همان دیتابیس (`lia_sync`) **فقط می‌خواند**.

## معماری

```
src/
  app/                      روتینگ و UI — نازک؛ فقط service صدا می‌زند
  server/services/          منطق کسب‌وکار
  server/repositories/      تنها جای دسترسی به DB (همه‌ی SQLها اینجا)
  lib/db/                   Pool، query/queryOne/withTransaction، نگاشت خطای Postgres → AppError
  lib/config/               اعتبارسنجی env با zod (fail fast)
  lib/errors/               AppError: کد ثابت + پیام فارسی امن برای کاربر
  lib/logger/               لاگ JSON یک‌خطی با پاک‌سازی رازها
  instrumentation.ts        چک env هنگام بالا آمدن؛ خطا ⇒ پیام واضح و exit 1
```

قواعد (ESLint اجبارشان می‌کند):

- `pg` و `@/lib/db` فقط در `src/lib/db` و `src/server/repositories` import می‌شوند.
- `console` فقط داخل logger.
- هر کوئری از `query()` می‌گذرد: خطا لاگ می‌شود (با برچسب، بدون پارامترها) و به `AppError` تبدیل می‌شود.

| کد Postgres                                  | AppError          | HTTP |
| -------------------------------------------- | ----------------- | ---- |
| 23505                                        | CONFLICT          | 409  |
| 23503                                        | INVALID_REFERENCE | 422  |
| 23514 / 23502 / 22P02                        | INVALID_DATA      | 422  |
| 57014 (statement timeout)                    | DB_TIMEOUT        | 504  |
| اتصال (ECONNREFUSED، 08xxx، 28P01، 57P0x، …) | DB_UNAVAILABLE    | 503  |
| بقیه                                         | INTERNAL          | 500  |

## دیتابیس و جداسازی

`deploy/shop-db-roles.sql` (تراکنشی، هیچ جدول موجودی را تغییر نمی‌دهد):

|                          | Staging                                                             | Production |
| ------------------------ | ------------------------------------------------------------------- | ---------- |
| نقش                      | `lia_shop_staging`                                                  | `lia_shop` |
| اسکیمای جدول‌های فروشگاه | `shop_staging`                                                      | `shop`     |
| کاتالوگ تأمین‌کننده      | `product_catalog`، `categories` — فقط خواندن، **بدون `cost_price`** | همان       |

نقش staging به اسکیمای production دسترسی ندارد و برعکس. هیچ‌کدام نمی‌توانند داده‌ی ربات را تغییر دهند.

## پورت‌ها

| سرویس                         | پورت (فقط 127.0.0.1) |
| ----------------------------- | -------------------- |
| liateam-dashboard (موجود)     | 3847                 |
| **liateam-shop** (production) | 3849                 |
| **liateam-shop-staging**      | 3850                 |

## متغیرهای محیطی

فهرست کامل در `.env.example`. اجباری: `APP_ENV`، `PORT`، `DATABASE_URL`، `DB_SCHEMA`.
اختیاری: `DB_POOL_MAX` (۵)، `DB_STATEMENT_TIMEOUT_MS` (۱۰۰۰۰)، `LOG_LEVEL` (info).
در staging، `DB_SCHEMA` باید به `_staging` ختم شود (اپ در غیر این صورت بالا نمی‌آید).

> `PORT` از محیط پروسه خوانده می‌شود (systemd `EnvironmentFile`)؛ فایل `.env` پورت را عوض نمی‌کند.

## توسعه‌ی محلی

```bash
cp .env.example .env.local      # DATABASE_URL محلی: 127.0.0.1:5433 (docker compose ریشه‌ی ریپو)
npm install
npm run dev                     # http://127.0.0.1:3850
npm run check                   # typecheck + lint + prettier
```

## استقرار روی سرور (یک بار)

فقط این‌ها ساخته می‌شود: کاربر `liateam-shop`، پوشه‌ی `/opt/liateam-shop`، نقش‌ها و اسکیماهای بالا، و سرویس‌های `liateam-shop*`. سرویس‌های `liateam-*` موجود و سایت دیگر دست نمی‌خورند.

```bash
# ۱. کاربر و پوشه‌ها
sudo useradd --system --home /opt/liateam-shop --shell /usr/sbin/nologin liateam-shop
sudo mkdir -p /opt/liateam-shop/{staging,production,env}
sudo git clone -b feature/shop https://github.com/mohammadch77/liateam-bot.git /opt/liateam-shop/staging/app
sudo chown -R liateam-shop:liateam-shop /opt/liateam-shop && sudo chmod 700 /opt/liateam-shop/env

# ۲. نقش‌های دیتابیس (رمزها را خودتان بسازید: openssl rand -hex 24)
sudo -u postgres psql lia_sync -v staging_pw="'رمز_staging'" -v prod_pw="'رمز_production'" \
  -f /opt/liateam-shop/staging/app/shop/deploy/shop-db-roles.sql

# ۳. فایل env (فقط مالک بخواند)
sudo -u liateam-shop cp /opt/liateam-shop/staging/app/shop/.env.example /opt/liateam-shop/env/staging.env
sudo -u liateam-shop chmod 600 /opt/liateam-shop/env/staging.env
sudo -u liateam-shop nano /opt/liateam-shop/env/staging.env   # APP_ENV=staging PORT=3850 DB_SCHEMA=shop_staging DATABASE_URL=...@127.0.0.1:5432/lia_sync

# ۴. build و سرویس
cd /opt/liateam-shop/staging/app/shop && sudo -u liateam-shop npm ci && sudo -u liateam-shop npm run build
sudo cp deploy/liateam-shop-staging.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now liateam-shop-staging
curl -s http://127.0.0.1:3850/health
```

به‌روزرسانی staging:

```bash
cd /opt/liateam-shop/staging/app && sudo -u liateam-shop git pull
cd shop && sudo -u liateam-shop npm ci && sudo -u liateam-shop npm run build && sudo systemctl restart liateam-shop-staging
```

Production همین مراحل است با `production/`، `production.env` (`APP_ENV=production PORT=3849 DB_SCHEMA=shop`، نقش `lia_shop`) و `liateam-shop.service` — در زمان تحویل نهایی.

نمایش staging به کارفرما با رمز عبور: `deploy/nginx-shop-staging.conf`.

## مایگریشن دیتابیس

ابزار: node-pg-migrate با فایل‌های SQL خام در `migrations/` (هر فایل: `-- Up Migration` و `-- Down Migration`، هر کدام در یک تراکنش).
نام‌ها بدون schema نوشته می‌شوند؛ اسکریپت `search_path` را روی `DB_SCHEMA` می‌گذارد، پس **همان فایل‌ها** روی `shop` و `shop_staging` اجرا می‌شوند.
جدول ردیابی `pgmigrations` داخل همان schema است، نه public. مایگریشن اول اگر schema اشتباه باشد متوقف می‌شود.

| دستور                         | کار                                          |
| ----------------------------- | -------------------------------------------- |
| `npm run migrate:status`      | فهرست اجراشده / در انتظار                    |
| `npm run migrate:up`          | اجرای همه‌ی مایگریشن‌های در انتظار           |
| `npm run migrate:down`        | برگرداندن آخرین مایگریشن (`-- 3` یعنی سه تا) |
| `npm run migrate:down -- all` | برگرداندن همه — در production رد می‌شود      |

### دو نقش برای هر محیط

|            | مالک schema، اجرای مایگریشن | اپ در حال اجرا                                    |
| ---------- | --------------------------- | ------------------------------------------------- |
| Staging    | `lia_shop_staging_migrator` | `lia_shop_staging`                                |
| Production | `lia_shop_migrator`         | `lia_shop`                                        |
| دسترسی     | DDL فقط در schema خودش      | SELECT / INSERT / UPDATE — بدون DELETE و بدون DDL |

دسترسی اپ از طریق default privileges خودکار به هر جدول جدید داده می‌شود؛ فایل‌های مایگریشن نام هیچ نقشی را نمی‌آورند.
`audit_log` با trigger کاملاً append-only است (UPDATE/DELETE برای هیچ نقشی ممکن نیست).

### اجرا روی سرور

یک بار، بعد از `shop-db-roles.sql`:

```bash
sudo -u postgres psql lia_sync -v staging_pw="'رمز_migrator_staging'" -v prod_pw="'رمز_migrator_production'" \
  -f /opt/liateam-shop/staging/app/shop/deploy/shop-db-roles-002-migrator.sql
```

در `/opt/liateam-shop/env/staging.env` اضافه کنید (اپ از آن استفاده نمی‌کند، فقط اسکریپت مایگریشن):

```
MIGRATION_DATABASE_URL=postgres://lia_shop_staging_migrator:…@127.0.0.1:5432/lia_sync
```

هر بار بعد از `git pull` و قبل از restart:

```bash
cd /opt/liateam-shop/staging/app/shop
sudo -u liateam-shop bash -c 'set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run migrate:up'
```

Production همین است با `production.env` (`APP_ENV=production`، `DB_SCHEMA=shop`، نقش `lia_shop_migrator`). قبل از مایگریشن production بکاپ بگیرید:

```bash
sudo -u postgres pg_dump -n shop -Fc lia_sync > shop-$(date +%F).dump
```

## /health

`GET /health` ← `SELECT 1` روی Pool.

- `200 {"status":"ok", "checks":{"database":{"status":"up","latencyMs":…}}}`
- `503 {"status":"degraded", "checks":{"database":{"status":"down","code":"DB_UNAVAILABLE"}}}`

جزئیات خطا (پیام درایور، آدرس سرور) هرگز در پاسخ نمی‌آید؛ فقط در لاگ و بدون رمز.

## احراز هویت (OTP پیامکی)

```
src/server/sms/                 SmsProvider: dev (کد در لاگ) · kavenegar (verify/lookup) — انتخاب با SMS_PROVIDER
src/server/services/auth.service.ts      درخواست/تأیید کد، ساخت کاربر و نشست، خروج — OTP_POLICY
src/server/services/session.service.ts   getCurrentUser (یک کوئری در هر درخواست)، hasRole
src/server/auth/guards.ts       requireUser (هدایت به /login) · requireRole (HTTP 403) · authorize (API: 401/403)
src/server/auth/cookie.ts       کوکی نشست
src/server/http/action.ts       runAction: بررسی Origin (CSRF) + تبدیل خطا برای همه‌ی Server Actionها
```

| سیاست                      | مقدار                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| طول و اعتبار کد            | ۶ رقم · ۲ دقیقه                                                              |
| ارسال دوباره برای یک شماره | حداقل ۶۰ ثانیه فاصله، حداکثر ۵ کد در ساعت                                    |
| هر IP                      | حداکثر ۲۰ کد در ساعت (فقط با `TRUST_PROXY=1` پشت nginx)                      |
| تلاش برای هر کد            | ۵ بار؛ بعد کد باطل است                                                       |
| قفل                        | ۱۰ کد اشتباه برای یک شماره در ۳۰ دقیقه ⇒ نه تأیید، نه کد جدید                |
| نشست                       | ۳۰ روز (`SESSION_TTL_DAYS`)، قابل ابطال؛ خروج نشست را در دیتابیس باطل می‌کند |

- کد فقط به‌صورت HMAC-SHA256 با `AUTH_SECRET` ذخیره می‌شود؛ توکن نشست (۲۵۶ بیت) فقط به‌صورت SHA-256.
- کوکی: `httpOnly`، `SameSite=Lax`، و با HTTPS `Secure` و پیشوند `__Host-`.
- پیام‌ها عمومی‌اند: پاسخ درخواست کد برای شماره‌ی ثبت‌شده و ثبت‌نشده یکی است.
- ورود، خروج، قفل و اعطای نقش در `audit_log` ثبت می‌شوند.

دادن نقش (مثلاً اولین مدیر):

```bash
npm run grant-role -- 09121234567 admin
```

روی سرور: `sudo -u liateam-shop bash -c 'set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run grant-role -- 0912… admin'`

مسیرهای نمونه: `/account` (فقط کاربر واردشده) · `/admin` و `GET /api/admin/ping` (فقط admin؛ بقیه ۴۰۳).
