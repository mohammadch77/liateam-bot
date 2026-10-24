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

**فونت:** `src/app/fonts/Vazirmatn-Variable.woff2` زیرمجموعه‌ی Vazirmatn است (فقط حروفی که فروشگاه نشان می‌دهد، همه‌ی وزن‌ها؛ ۶۸ به‌جای ۱۰۸ کیلوبایت) و مجوزش (SIL OFL 1.1) کنارش در `OFL.txt` است. `npm run font:check` همه‌ی متن‌های دیتابیس و رابط را با فونت مقایسه می‌کند و هر حرفی که در فونت نیست فهرست می‌کند (اگر حرفی در Vazirmatn کامل هست ولی در زیرمجموعه نیست، خروجی ۱). برای افزودن حرف: `UNICODES` در `scripts/subset-font.py` و `python scripts/subset-font.py` (نیاز: `pip install fonttools brotli`).

## تست‌ها

| دستور                               | چه چیزی را می‌سنجد                                               | نیاز                          |
| ----------------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| `npm run check`                     | typecheck، lint، prettier                                        | —                             |
| `npm run check:responsive -- <url>` | همه‌ی صفحه‌ها در ۳۶۰ تا ۱۹۲۰ پیکسل بدون اسکرول افقی              | اپ در حال اجرا                |
| `npm run check:prices -- <url>`     | قیمت‌ها به تومان و برابر قیمت ذخیره‌شده                          | اپ + دیتابیس                  |
| `npm run check:search -- <url>`     | نرمال‌ساز SQL و TS یکی است؛ پیشنهادها فقط فیلدهای عمومی دارند    | اپ + دیتابیس                  |
| `npm run test:e2e`                  | end-to-end: ورود، کاتالوگ، مگامنو، جست‌وجو، صفحه‌ی محصول (پایین) | اپ محلی + Docker + Playwright |

ربات و داشبورد تست‌های خودشان را در ریشه‌ی ریپو دارند (`npm test`).

### تست‌های end-to-end (`tests/e2e/`)

مرورگر واقعی (Playwright) روی اپِ در حال اجرا:

| فایل               | پوشش                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.e2e.mjs`     | ورود با کد، نشست و کوکی، محدودیت شماره و IP، انقضا، قفل بعد از ۱۰ کد اشتباه، نقش‌ها و ۴۰۳، CSRF، خروج، audit log                                                                          |
| `catalog.e2e.mjs`  | خانه، دسته (تعداد، صفحه‌بندی، مرتب‌سازی، فیلترها)، محصول (قیمت تومان)، جست‌وجو، به‌روز شدن قیمت/موجودی، محصولات مخفی، ریدایرکت‌ها، سئو، عکس‌ها، **هیچ لینک هدر/فوتر/نوار پایین ۴۰۴ نیست** |
| `megamenu.e2e.mjs` | ترتیب لیاتیم (از دیتابیس)، باز/بسته شدن با هاور/کلیک/Esc/کلیک بیرون، Tab، لینک‌ها، کشوی موبایل، بدون اسکرول افقی                                                                          |
| `search.e2e.mjs`   | پیشنهاد حین تایپ، هایلایت، ي/ك و غلط املایی، ↑/↓/Enter/Esc و «/»، صفحه‌ی نتایج و رتبه‌بندی، مرتب‌سازی، حالت بی‌نتیجه، عرض‌ها                                                              |

**پیش‌نیاز (یک‌بار):**

- Playwright در ریشه‌ی ریپو نصب باشد: `npm ci` و سپس `npx playwright install chromium`.
- دیتابیس Docker محلی بالا باشد (`npm run db:up` در ریشه) و ربات یک‌بار sync کرده باشد.

**اجرا:** اپ را **محلی** با `SMS_PROVIDER=dev` (پیش‌فرض) و `TRUST_PROXY=1` بالا بیاورید و خروجی‌اش را در فایل بنویسید. تست ورود کد پیامکی را از همین فایل می‌خواند، چون ارائه‌دهنده‌ی dev کد را فقط لاگ می‌کند.

```powershell
# پنجره‌ی ۱ — اپ (PowerShell؛ در bash: TRUST_PROXY=1 npx next start -p 3852 > /tmp/shop-e2e.log 2>&1)
npm run build
$env:TRUST_PROXY = '1'; npx next start -H 127.0.0.1 -p 3852 *> $env:TEMP\shop-e2e.log

# پنجره‌ی ۲ — تست‌ها
$env:E2E_BASE_URL = 'http://127.0.0.1:3852'
$env:E2E_SERVER_LOG = "$env:TEMP\shop-e2e.log"
npm run test:e2e                       # همه‌ی تست‌ها، با خلاصه
npm run test:e2e -- search megamenu    # فقط این‌ها
```

| متغیر             | کار                                                  |
| ----------------- | ---------------------------------------------------- |
| `E2E_BASE_URL`    | آدرس اپ (پیش‌فرض `http://127.0.0.1:$PORT`)           |
| `E2E_SERVER_LOG`  | فایل خروجی اپ؛ برای تست ورود و صفحه‌ی محصول لازم است |
| `E2E_SCREENSHOTS` | اختیاری: پوشه‌ای برای اسکرین‌شات‌ها                  |

**نکته‌ها:**

- **فقط محلی:** تست‌های ورود و کاتالوگ ردیف‌های دیتابیس را تغییر می‌دهند (زمان کدها، قیمت یک محصول که بعد برگردانده می‌شود)، پس فقط با اپ محلی و دیتابیس Docker اجرا می‌شوند و در برابر آدرس دیگری با خطا متوقف می‌شوند. تست جست‌وجو فقط می‌خواند و روی هر آدرسی اجرا می‌شود.
- **شماره و IP:** هر اجرا شماره‌ها و IPهای تازه می‌سازد، پس به اجرای قبلی وابسته نیست. سقف ۲۰ کد در ساعت برای هر IP هم مشکلی نمی‌سازد.
- **انتظار برای پاسخ سرور، نه network-idle:** Next.js لینک صفحه‌ها را از قبل بارگیری می‌کند و بعضی از این درخواست‌ها باز می‌مانند. تست‌ها منتظر پاسخ Server Action می‌مانند، نه «بیکار شدن شبکه».
- **قیمت:** همه‌ی مقایسه‌ها به تومان و بدون تقسیم بر ۱۰ است.

## استقرار (رانبوک)

همه‌ی قدم‌های سروری فاز ۱ در یک‌جا و به ترتیب اجرا. هر قدم یک برچسب دارد:

- **[یک‌بار]**: فقط در اولین راه‌اندازی هر محیط.
- **[هر دیپلوی]**: بعد از هر `git pull`.
- **[وقتی …]**: فقط وقتی آن اتفاق بیفتد.

دستورها برای **staging** نوشته شده‌اند. تفاوت‌های production در «Production» آخر همین بخش آمده است.

**مرزها:** فقط این‌ها ساخته یا تغییر داده می‌شوند:

- پوشه‌های `/opt/liateam-bot` و `/opt/liateam-shop`
- سرویس‌های `liateam-*`
- نقش‌ها و اسکیماهای فروشگاه
- یک سایت nginx جدید

سایت دیگرِ روی سرور، سرویس‌های دیگر، تنظیمات Postgres و بسته‌های سیستم دست نمی‌خورند. nginx فقط `reload` می‌شود، هرگز `restart`، و سرور بدون هماهنگی ری‌استارت نمی‌شود.

| کجا                    | مسیر                                                     | کاربر لینوکس   |
| ---------------------- | -------------------------------------------------------- | -------------- |
| ربات و داشبورد (موجود) | `/opt/liateam-bot/app` (شاخه‌ی `feature/shop`)           | `liateam`      |
| فروشگاه staging        | `/opt/liateam-shop/staging/app/shop`                     | `liateam-shop` |
| فروشگاه production     | `/opt/liateam-shop/production/app/shop`                  | `liateam-shop` |
| env فروشگاه            | `/opt/liateam-shop/env/{staging,production}.env` (`600`) | `liateam-shop` |

### ۰. پیش‌نیاز: ربات روی آخرین کد **[هر دیپلوی]**

فروشگاه فقط کاتالوگ ربات را می‌خواند. ستون‌ها (برند، توضیحات، ترتیب دسته) را ربات می‌سازد، پس ربات باید جلوتر یا هم‌زمان به‌روز شود.

```bash
cd /opt/liateam-bot/app && sudo -u liateam git pull --ff-only
sudo -u liateam npm ci                        # فقط اگر package-lock.json عوض شده باشد
sudo systemctl restart liateam-worker liateam-messenger liateam-orders
# فقط اگر dashboard/ عوض شده باشد:
cd dashboard && sudo -u liateam npm ci && sudo -u liateam npm run build && sudo systemctl restart liateam-dashboard
```

چرا: worker در اجرای بعدی، اسکیمای جدید (`CREATE … IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) را خودش می‌سازد. بعد از اولین sync با کد جدید، ستون‌های `brand` و `description` و `position` وجود دارند و اسکریپت‌های قدم ۲ پیدایشان می‌کنند.

### ۱. کاربر، پوشه و کد فروشگاه **[یک‌بار]**

```bash
sudo useradd --system --home /opt/liateam-shop --shell /usr/sbin/nologin liateam-shop
sudo mkdir -p /opt/liateam-shop/{staging,production,env}
sudo git clone -b feature/shop https://github.com/mohammadch77/liateam-bot.git /opt/liateam-shop/staging/app
sudo chown -R liateam-shop:liateam-shop /opt/liateam-shop && sudo chmod 700 /opt/liateam-shop/env
```

چرا: فروشگاه کاربر، کد و فایل env جدا از ربات دارد. خطا یا نفوذ در یکی به دیگری نمی‌رسد.

### ۲. دیتابیس: نقش‌ها و دسترسی‌ها **[یک‌بار، به ترتیب، با کاربر postgres]**

هر پنج فایل تراکنشی‌اند (یا همه‌اش اعمال می‌شود یا هیچ) و هیچ داده‌ای را تغییر نمی‌دهند. رمزها را بسازید (`openssl rand -hex 24`)، فقط در فایل env بگذارید و جای دیگری ننویسید.

```bash
cd /opt/liateam-shop/staging/app/shop/deploy

# ۲-الف. نقش‌های اپ و اسکیماها (lia_shop_staging / lia_shop, shop_staging / shop)؛ کاتالوگ فقط‌خواندنی، بدون cost_price
sudo -u postgres psql lia_sync -v staging_pw="'…'" -v prod_pw="'…'" -f shop-db-roles.sql

# ۲-ب. نقش‌های مالک اسکیما برای مایگریشن (اپ هرگز از آن‌ها استفاده نمی‌کند)
sudo -u postgres psql lia_sync -v staging_pw="'…'" -v prod_pw="'…'" -f shop-db-roles-002-migrator.sql

# ۲-ج. خواندن برند و توضیحات محصول؛ اگر ربات هنوز با کد جدید sync نکرده باشد، با پیام واضح متوقف می‌شود (قدم ۰)
sudo -u postgres psql lia_sync -f shop-db-roles-003-catalog-details.sql

# ۲-د. جست‌وجو: افزونه‌ی pg_trgm، تابع‌های نرمال‌سازی و ایندکس GIN روی جدول محصولات ربات
sudo -u postgres psql lia_sync -f shop-db-004-search.sql

# ۲-ه. خواندن سکشن‌های غنی محصول (مشخصات، نحوه‌ی استفاده، ویدیو، سوالات متداول، نظرات، برندها، اسلاگ انگلیسی)؛ ربات باید یک‌بار با کد جدید sync کرده باشد
sudo -u postgres psql lia_sync -f shop-db-roles-005-rich-content.sql

# ۲-و تا ۲-ح. گالری، اسلایدر، مشخصات کلیدی (۰۰۶ تا ۰۰۸)
sudo -u postgres psql lia_sync -f shop-db-roles-006-gallery.sql
sudo -u postgres psql lia_sync -f shop-db-roles-007-hero.sql
sudo -u postgres psql lia_sync -f shop-db-roles-008-product-facts.sql

# ۲-ط. قیمت تخفیف‌خورده: تابع shop_offer_prices (قیمت خرید فقط داخل دیتابیس خوانده می‌شود؛ اپ فقط قیمت نهایی را می‌گیرد)
sudo -u postgres psql lia_sync -f shop-db-roles-009-offer-prices.sql


# ۲-ی. قیمت پک‌ها (روتین پوستی و …): تابع shop_pack_price، با همان قاعده‌ی کف قیمت خرید
sudo -u postgres psql lia_sync -f shop-db-roles-010-pack-prices.sql
```

تا `009` اجرا نشود، فروشگاه بدون هیچ تخفیفی و با قیمت لیاتیم کار می‌کند و هشدار `discount.offer_prices_unavailable` در لاگ می‌ماند؛ تا `010` اجرا نشود، پک‌ها «فعلاً در دسترس نیست» نشان داده می‌شوند. تنظیم‌ها (درصد):

- `OUR_BASE_MARGIN_PERCENT` (پیش‌فرض ۴): تخفیف لیاتیم به حساب ما تا این درصد سود ماست؛ فقط بیشتر از آن به مشتری می‌رسد.
- `DISCOUNT_MAX_PERCENT` (۳۰): سقف کل تخفیف هر محصول.
- `DISCOUNT_MIN_MARGIN_PERCENT` (پیش‌فرض ۱): هیچ تخفیف یا پکی قیمت را از «قیمت خرید + این درصد» پایین‌تر نمی‌برد، تا قیمت نمایشی هیچ‌وقت خودِ قیمت خرید نباشد. فقط تخفیفی که مدیر روی آن «اجازه‌ی فروش با زیان» را زده از این کف معاف است.

چرا با کاربر postgres: ساختن نقش و `CREATE EXTENSION` دسترسی مالک دیتابیس می‌خواهد. `004` را می‌شود بی‌خطر دوباره اجرا کرد. تا اجرا نشود، فروشگاه بالا می‌آید ولی جست‌وجو فقط زیررشته‌ی ساده در نام است و یک هشدار `catalog.search_fallback` در لاگ می‌ماند.

> اگر بعدها فایل `.sql` جدیدی در `shop/deploy/` آمد، همان‌جا با شماره‌ی بعدی اضافه می‌شود و یک‌بار با postgres اجرا می‌شود.

### ۳. فایل env **[یک‌بار؛ ویرایش وقتی مقداری عوض شود]**

```bash
sudo -u liateam-shop cp /opt/liateam-shop/staging/app/shop/.env.example /opt/liateam-shop/env/staging.env
sudo -u liateam-shop chmod 600 /opt/liateam-shop/env/staging.env
sudo -u liateam-shop nano /opt/liateam-shop/env/staging.env
```

| متغیر                                                                     | staging                                                 | production             | چرا / نکته                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                                 | `staging`                                               | `production`           | قواعد ایمنی هر محیط را روشن می‌کند                                                                                            |
| `PORT`                                                                    | `3850`                                                  | `3849`                 | با داشبورد (۳۸۴۷) و سایت دیگر تداخل ندارد                                                                                     |
| `DATABASE_URL`                                                            | `postgres://lia_shop_staging:…@127.0.0.1:5432/lia_sync` | `…lia_shop:…`          | نقش اپ از ۲-الف                                                                                                               |
| `DB_SCHEMA`                                                               | `shop_staging`                                          | `shop`                 | در staging باید به `_staging` ختم شود، وگرنه اپ بالا نمی‌آید                                                                  |
| `MIGRATION_DATABASE_URL`                                                  | `postgres://lia_shop_staging_migrator:…@…`              | `…lia_shop_migrator:…` | فقط برای `migrate:*`                                                                                                          |
| `AUTH_SECRET`                                                             | `openssl rand -hex 32`                                  | **مقدار جدا**          | کلید HMAC کدهای OTP؛ هر محیط کلید خودش را دارد                                                                                |
| `COOKIE_SECURE`                                                           | `1`                                                     | `1` (اجباری)           | کوکی `__Host-`/`Secure` فقط روی HTTPS کار می‌کند، پس staging هم HTTPS لازم دارد (قدم ۶)                                       |
| `TRUST_PROXY`                                                             | `1`                                                     | `1`                    | پشت nginx، IP واقعی از `X-Real-IP` خوانده می‌شود و محدودیت هر IP (OTP، پیشنهاد جست‌وجو) کار می‌کند. بدون nginx هرگز ۱ نگذارید |
| `BRAND_NAME` / `BRAND_LATIN`                                              | `آوینا` / `AVINA BEAUTY`                                | همان یا نام نهایی      | نام برند در کد ثابت نیست؛ با عوض کردن این دو و restart تغییر می‌کند                                                           |
| `SUPPORT_PHONE`                                                           | شماره‌ی پشتیبانی                                        | همان                   | در نوار بالای هدر نمایش داده می‌شود؛ خالی = نمایش داده نمی‌شود                                                                |
| `SMS_PROVIDER`                                                            | `dev` (تا آمدن کلید) یا `kavenegar`                     | `kavenegar` (اجباری)   | `dev` کد را فقط در لاگ سرور می‌نویسد و در production رد می‌شود                                                                |
| `KAVENEGAR_API_KEY` / `KAVENEGAR_OTP_TEMPLATE`                            | خالی تا آمدن کلید                                       | اجباری                 | الگوی verify تأییدشده در پنل کاوه‌نگار با `%token`                                                                            |
| `DB_POOL_MAX`، `DB_STATEMENT_TIMEOUT_MS`، `LOG_LEVEL`، `SESSION_TTL_DAYS` | پیش‌فرض                                                 | پیش‌فرض                | اختیاری                                                                                                                       |

خطای پیکربندی، اپ را با پیام واضح و `exit 1` متوقف می‌کند (`systemctl status liateam-shop-staging` آن را نشان می‌دهد) و سرویس در حلقه‌ی ری‌استارت نمی‌افتد.

### ۴. نصب، مایگریشن و build **[هر دیپلوی]**

```bash
cd /opt/liateam-shop/staging/app && sudo -u liateam-shop git pull --ff-only     # در اولین بار لازم نیست
cd shop
sudo -u liateam-shop npm ci
sudo -u liateam-shop bash -c 'set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run migrate:up'
sudo -u liateam-shop npm run build
```

چرا به این ترتیب: مایگریشن پیش از build و restart اجرا می‌شود تا کد جدید هیچ‌وقت روی اسکیمای قدیمی بالا نیاید. `migrate:up` فقط مایگریشن‌های اجرانشده را اجرا می‌کند، پس تکرارش بی‌خطر است. `npm run migrate:status` وضعیت را نشان می‌دهد.

### ۵. سرویس systemd **[نصب یک‌بار، restart هر دیپلوی]**

```bash
# یک‌بار:
sudo cp /opt/liateam-shop/staging/app/shop/deploy/liateam-shop-staging.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now liateam-shop-staging
# هر دیپلوی:
sudo systemctl restart liateam-shop-staging
curl -s http://127.0.0.1:3850/health          # {"status":"ok",…}
```

چرا: سرویس با کاربر خودش، فایل env خودش و سخت‌گیری‌های systemd (`NoNewPrivileges` و `ProtectSystem` و…) اجرا می‌شود و فقط روی 127.0.0.1 گوش می‌دهد.

### ۶. nginx برای staging، با رمز عبور و HTTPS **[یک‌بار]**

```bash
sudo cp /opt/liateam-shop/staging/app/shop/deploy/nginx-shop-staging.conf /etc/nginx/sites-available/liateam-shop-staging
sudo nano /etc/nginx/sites-available/liateam-shop-staging        # server_name را با دامنه/زیردامنه‌ی staging عوض کنید
sudo htpasswd -c /etc/nginx/liateam-shop-staging.htpasswd client # رمز را جدا به کارفرما بدهید
sudo ln -s /etc/nginx/sites-available/liateam-shop-staging /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d staging.example.com
```

چرا:

- **رمز عبور:** staging پیش‌نمایش خصوصی کارفرماست.
- **`noindex`:** گوگل staging را ایندکس نمی‌کند.
- **HTTPS:** کوکی نشست امن بدون آن کار نمی‌کند.
- **`reload` به‌جای `restart`:** سایت دیگرِ روی سرور قطع نمی‌شود.

اگر هنوز دامنه‌ای نیست، می‌شود موقتاً از الگوی گواهی خودامضا روی IP استفاده کرد (`dashboard/deploy/nginx-ip-selfsigned.conf`)، با هشدار مرورگر.

### ۷. درخت دسته‌ها **[یک‌بار؛ روی سرور فعلی انجام شده]**

```bash
cd /opt/liateam-bot/app && sudo -u liateam node explore/compare-category-tree.mjs           # فقط گزارش
cd /opt/liateam-bot/app && sudo -u liateam node explore/compare-category-tree.mjs --apply   # اعمال + تأیید
```

چرا: ترتیب و ساختار دسته‌ها را بی‌درنگ با لیاتیم یکی می‌کند. از آن به بعد هر sync همین کار را خودش انجام می‌دهد و فقط تغییرها را می‌نویسد. خروجی درست بعد از اعمال: `0 difference(s)`.

### ۸. اولین مدیر **[یک‌بار]**

حساب را اگر وجود نداشته باشد می‌سازد و در `audit_log` ثبت می‌کند:

```bash
cd /opt/liateam-shop/staging/app/shop
sudo -u liateam-shop bash -c 'set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run grant-role -- 0912xxxxxxx admin'
```

### ۹. گرم کردن کش عکس‌ها **[یک‌بار بعد از نصب، و بعد از هر sync]**

```bash
cd /opt/liateam-shop/staging/app/shop
sudo -u liateam-shop bash -c 'set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run images:warm'
```

چرا: عکس‌های تأمین‌کننده PNGهای ۱ تا ۶ مگابایتی‌اند. اولین درخواست هر اندازه را سرور ما دانلود و کوچک می‌کند (روی سیستم توسعه ۳ تا ۴ ثانیه برای هر عکس) و بعد از کش در چند میلی‌ثانیه برمی‌گردد. این اسکریپت همه‌ی اندازه‌هایی که صفحه‌ها واقعاً می‌خواهند (کارت، گالری، منو، پک و بنرهای اسلایدر) را از قبل در کش می‌گذارد و تکرارش بی‌خطر است. بعد از نصب و بعد از هر sync که عکسی را عوض کرده اجرایش کنید (مثلاً با یک cron ساعتی که بی‌هزینه است چون عکسِ کش‌شده فوراً رد می‌شود). کش عکس‌ها در `.next/cache/images` است: در دیپلوی پاکش نکنید (`npm run build` آن را نگه می‌دارد).

**خودکار (پیشنهادی):** تایمر systemd که از ساعت ۷ تا ۲۲ (به وقت تهران) هر ساعت همین اسکریپت را اجرا می‌کند و یک‌بار هم بعد از هر دیپلوی دستی. اسکریپت با سرور مشترک ملایم است: هر بار یک عکس، بعد از هر عکسی که سرور کوچکش کرده ۱ تا ۳ ثانیه مکث (عکس‌هایی که از قبل در کش هستند مکث ندارند)، در هر اجرا حداکثر ۳۰۰ عکس (`IMAGES_WARM_MAX`) و بقیه برای اجرای بعدی. بین ساعت ۲۳ تا ۷ اجرا نمی‌شود، مگر دستی با `-- --any-time`:

```bash
sudo cp /opt/liateam-shop/staging/app/shop/deploy/liateam-shop-images-warm.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now liateam-shop-images-warm.timer
# بعد از هر دیپلوی:
sudo systemctl start liateam-shop-images-warm
# (ساعت ۲۳ تا ۷ این دستور کاری نمی‌کند؛ اگر لازم بود، دستی و بدون محدودیت ساعت:)
# sudo -u liateam-shop bash -c 'cd /opt/liateam-shop/staging/app/shop && set -a && . /opt/liateam-shop/env/staging.env && npm run images:warm -- --any-time'
```

### ۱۰. پیامک واقعی **[وقتی کلید کاوه‌نگار آمد]**

۱. در پنل کاوه‌نگار یک الگوی **verify** با `%token` بسازید و منتظر تأییدش بمانید.
۲. در `staging.env`: `SMS_PROVIDER=kavenegar`، `KAVENEGAR_API_KEY=…`، `KAVENEGAR_OTP_TEMPLATE=نام_الگو`.
۳. `sudo systemctl restart liateam-shop-staging`، سپس با یک شماره‌ی واقعی وارد شوید.

تا آن زمان (`SMS_PROVIDER=dev`) کد ورود در لاگ است:

```bash
sudo journalctl -u liateam-shop-staging --since "-10min" | grep sms.dev.otp
```

### ۱۱. بررسی بعد از دیپلوی **[هر دیپلوی]**

```bash
curl -s http://127.0.0.1:3850/health
cd /opt/liateam-shop/staging/app/shop
sudo -u liateam-shop bash -c 'set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run check:prices -- http://127.0.0.1:3850 && npm run check:search -- http://127.0.0.1:3850'
sudo journalctl -u liateam-shop-staging --since "-10min" -p warning
```

`check:prices` می‌گوید قیمت‌ها درست (به تومان) نمایش داده می‌شوند. `check:search` می‌گوید جست‌وجو و نرمال‌سازی درست کار می‌کنند و از API چیزی جز فیلدهای عمومی بیرون نمی‌آید. کارت «وضعیت فروشگاه» در داشبورد هم `/health` هر دو محیط را نشان می‌دهد (`SHOP_HEALTH_URLS`؛ پیش‌فرض‌ها ۳۸۵۰ و ۳۸۴۹ است و نیازی به تنظیم ندارد).

### خلاصه: هر دیپلوی

| ترتیب | کار                                                                             |
| ----- | ------------------------------------------------------------------------------- |
| ۱     | ربات: `git pull` ← (`npm ci`) ← restart سرویس‌های `liateam-*` ← (build داشبورد) |
| ۲     | اگر فایل `.sql` تازه‌ای در `shop/deploy/` آمده: یک‌بار با postgres              |
| ۳     | فروشگاه: `git pull` ← `npm ci` ← `migrate:up` ← `build` ← `restart`             |
| ۴     | `/health`، `check:prices`، `check:search`، لاگ                                  |
| ۵     | `images:warm`                                                                   |

### سرعت: Nginx و CDN **[پیشنهاد؛ در کد حل‌شدنی نیست]**

اندازه‌گیری: `npm run perf -- https://staging.<دامنه>` (Lighthouse، میانه‌ی ۳ اجرا، موبایل و دسکتاپ) و `npm run test:e2e -- budget` (بودجه‌ی JS، وزن، CLS، نبودن درخواست محصول هنگام بارگذاری). بعد از نصب staging همین دو را روی آدرس واقعی اجرا کنید؛ عددهای سیستم توسعه (مخصوصاً موبایل) نوسان زیادی دارند.

**Nginx:**

- `listen 443 ssl http2;` (و اگر نسخه‌ی nginx اجازه می‌دهد `http3`)، `keepalive_timeout 65;`.
- فشرده‌سازی: Next خودش gzip می‌کند؛ اگر ماژول Brotli نصب است در nginx `brotli on; brotli_types text/css application/javascript application/json image/svg+xml;` و در `next.config.ts` گزینه‌ی `compress: false` تا دو بار فشرده نشود.
- `/_next/static/`: فایل‌ها نام هش‌دار دارند؛ `expires 1y; add_header Cache-Control "public, max-age=31536000, immutable";` (Next همین هدر را می‌فرستد؛ در nginx فقط حذفش نکنید).
- `/_next/image`: `proxy_cache` با کلید کامل آدرس (`$request_uri`) و `proxy_cache_valid 200 7d;` تا عکس‌های بهینه‌شده حتی به Next هم نرسند؛ `proxy_cache_use_stale updating;`.
- صفحه‌ها (HTML): کش نکنید؛ برای هر کاربر رندر می‌شوند (وضعیت ورود در هدر).

**CDN (آروان‌کلاد یا Cloudflare):**

- `/_next/static/*`: کش طولانی (۱ سال)، با احترام به هدر immutable.
- `/_next/image*`: کش ۷ روز، با query string در کلید کش (اندازه و کیفیت در آن است).
- `/api/nav/products*`: کش کوتاه (۶۰ ثانیه، همان `Cache-Control: public, max-age=60`).
- صفحه‌ها، `/api/*` دیگر، `/admin`, `/account`, `/login`: بدون کش (Bypass)؛ کوکی دارند یا شخصی‌اند.
- HTTP/3 و Brotli را در پنل CDN روشن کنید.

**سرور:** برای کاربر ایرانی، سرور داخل ایران (یا CDN با نقطه‌ی حضور داخل ایران مثل آروان) زمان پاسخ اول را از چند صد میلی‌ثانیه به چند ده میلی‌ثانیه می‌رساند؛ مهم‌ترین عامل LCP موبایل روی ۴G بعد از کد همین است.

### Production **[در تحویل نهایی]**

همان قدم‌ها، با این تفاوت‌ها:

- **مسیرها:** `production/` و `production.env`.
- **env:** `APP_ENV=production`، `PORT=3849`، `DB_SCHEMA=shop`، نقش‌های `lia_shop` و `lia_shop_migrator`، `AUTH_SECRET` جدا، `SMS_PROVIDER=kavenegar`.
- **سرویس:** `liateam-shop.service`.
- **nginx:** یک سایت جدید روی دامنه‌ی اصلی، بدون رمز عبور و بدون `noindex`. این فایل هنوز ساخته نشده و در فاز ۳ (استقرار روی دامنه‌ی اصلی) می‌آید.

قبل از هر مایگریشن production بکاپ بگیرید:

```bash
sudo -u postgres pg_dump -n shop -Fc lia_sync > shop-$(date +%F).dump
```

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

نقش‌های migrator در «استقرار» قدم ۲-ب ساخته می‌شوند و `migrate:up` در قدم ۴ هر دیپلوی اجرا می‌شود.

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

## کاتالوگ

| مسیر                 | صفحه                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                  | خانه: هیرو، دسته‌های اصلی، جدیدترین‌ها و منتخب‌ها                                                                                                              |
| `/categories`        | همه‌ی دسته‌ها و زیردسته‌ها                                                                                                                                     |
| `/c/173-آرایشی`      | دسته (همراه همه‌ی زیردسته‌هایش) · فیلتر زیردسته و «فقط موجود» · مرتب‌سازی · صفحه‌بندی                                                                          |
| `/p/541-ریمل-ابرو-…` | محصول                                                                                                                                                          |
| `/search?q=…`        | جست‌وجو در نام و برند: جزئی، خطاپذیر (غلط املایی، ي/ك عربی، نیم‌فاصله)، مرتب بر اساس ربط؛ پیشنهاد لحظه‌ای از `GET /api/search/suggest`؛ بدون `q` همه‌ی محصولات |

- داده فقط از `public.product_catalog` و `public.categories` (ربات همگام‌ساز) و فقط خواندنی؛ `cost_price` هیچ‌جا خوانده نمی‌شود.
- **قانون نمایش** (یک‌جا در `catalog.repository.ts`): `is_sellable` و `price > 0` و هنوز در فهرست تأمین‌کننده (`missing_since IS NULL`). ناموجود: نمایش با برچسب، بدون امکان خرید.
- تأمین‌کننده محصول را فقط به زیردسته وصل می‌کند؛ هر دسته = خودش + همه‌ی زیرمجموعه‌ها (CTE بازگشتی).
- آدرس‌ها: عدد = کد تأمین‌کننده، کلمات برای خواننده و موتور جست‌وجو. آدرس ناقص یا قدیمی ⇒ ۳۰۸ به آدرس اصلی (فیلترها حفظ می‌شوند؛ `src/proxy.ts`)، کد ناموجود ⇒ ۴۰۴ واقعی. این بررسی در layout است تا پیش از stream شدن اسکلتون انجام شود.
- فیلترها و مرتب‌سازی فرم GET ساده‌اند (بدون JavaScript هم کار می‌کنند؛ با JS بلافاصله اعمال می‌شوند).

### عکس محصولات

عکس‌ها روی `s3.liateam.ir` و PNG‌های ۱ تا ۶ مگابایتی‌اند. هرگز مستقیم به مرورگر نمی‌روند: `next/image` آن‌ها را یک‌بار
روی سرور ما می‌گیرد، به WebP کوچک تبدیل و یک هفته کش می‌کند (بدون hotlink، دامنه‌ی تأمین‌کننده هم دیده نمی‌شود).
اولین دریافت هر عکس کند است؛ بعد از هر همگام‌سازی کش را گرم کنید (روی سرور: «استقرار» قدم ۹):

```bash
npm run images:warm
```
