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

قرارداد کامل در `src/lib/config/index.ts` (zod) است و نمونه در `.env.example`. اپ هنگام بالا آمدن همه را بررسی می‌کند و با مقدار نامعتبر، با فهرست نام‌ها (بدون مقدار) و `exit 1` متوقف می‌شود. **راز** یعنی فقط در فایل env سرور (`600`)، هرگز در مخزن، لاگ یا پیام.

**فروشگاه** (`/opt/liateam-shop/env/{staging,production}.env`):

| متغیر                         | پیش‌فرض         | توضیح                                                                                                             | راز |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- | --- |
| `APP_ENV`                     | — (اجباری)      | `development` / `staging` / `production`؛ قواعد ایمنی هر محیط                                                     |     |
| `PORT`                        | — (اجباری)      | staging `3850`، production `3849`؛ از محیط پروسه (systemd) خوانده می‌شود                                          |     |
| `DATABASE_URL`                | — (اجباری)      | نقش اپ (`lia_shop_staging` / `lia_shop`)                                                                          | ✔   |
| `DB_SCHEMA`                   | — (اجباری)      | `shop_staging` / `shop`؛ در staging باید به `_staging` ختم شود                                                    |     |
| `DB_POOL_MAX`                 | `5`             | اتصال‌های هم‌زمان                                                                                                 |     |
| `DB_STATEMENT_TIMEOUT_MS`     | `10000`         | سقف زمان هر کوئری                                                                                                 |     |
| `LOG_LEVEL`                   | `info`          | `debug` / `info` / `warn` / `error`                                                                               |     |
| `BRAND_NAME`                  | — (اجباری)      | نام فارسی برند در همه‌ی صفحه‌ها (در کد ثابت نیست)                                                                 |     |
| `BRAND_LATIN`                 | خالی            | نام لاتین                                                                                                         |     |
| `SUPPORT_PHONE`               | خالی            | شماره‌ی نوار بالای هدر؛ خالی = نمایش داده نمی‌شود                                                                 |     |
| `AUTH_SECRET`                 | — (اجباری)      | کلید HMAC کدهای OTP، حداقل ۳۲ کاراکتر (`openssl rand -hex 32`)؛ هر محیط جدا                                       | ✔   |
| `SESSION_TTL_DAYS`            | `30`            | عمر نشست (۱ تا ۹۰)                                                                                                |     |
| `COOKIE_SECURE`               | `1`             | کوکی `Secure`؛ در production اجباری، پس HTTPS لازم است                                                            |     |
| `TRUST_PROXY`                 | `0`             | پشت nginx `1` (IP از `X-Real-IP`)؛ بدون پروکسی هرگز `1` نگذارید                                                   |     |
| `REVALIDATE_SECRET`           | خالی (خاموش)    | راز مشترک با ربات برای `POST /api/internal/revalidate`، حداقل ۳۲ کاراکتر؛ خالی = endpoint ۴۰۴                     | ✔   |
| `OUR_BASE_MARGIN_PERCENT`     | `4`             | تخفیف لیاتیم به حساب ما تا این درصد سود ماست؛ فقط بیشتر از آن به مشتری می‌رسد (۰ تا ۵۰)                           |     |
| `DISCOUNT_MAX_PERCENT`        | `30`            | سقف کل تخفیف مشتری روی هر محصول (عبوری + دستی؛ ۰ تا ۹۰)                                                           |     |
| `DISCOUNT_MIN_MARGIN_PERCENT` | `1` (توصیه‌شده) | کف قیمت = قیمت خرید + این درصد؛ هیچ تخفیف یا پکی پایین‌تر نمی‌رود، مگر «اجازه‌ی فروش با زیان» روشن باشد (۰ تا ۵۰) |     |
| `SMS_PROVIDER`                | `dev`           | `dev` (کد فقط در لاگ؛ در production رد می‌شود) یا `kavenegar`                                                     |     |
| `KAVENEGAR_API_KEY`           | خالی            | با `kavenegar` اجباری                                                                                             | ✔   |
| `KAVENEGAR_OTP_TEMPLATE`      | خالی            | نام الگوی verify تأییدشده با `%token`؛ با `kavenegar` اجباری                                                      |     |
| `MIGRATION_DATABASE_URL`      | خالی            | نقش مالک اسکیما (`…_migrator`)؛ فقط `npm run migrate:*` آن را می‌خواند                                            | ✔   |
| `IMAGES_WARM_MAX`             | `300`           | فقط `images:warm`: سقف عکس‌هایی که در یک اجرا کوچک می‌شوند                                                        |     |

**ربات** (`/opt/liateam-bot/app/.env`؛ فقط موارد مرتبط با فروشگاه و زمان‌بندی؛ فهرست کامل در `.env.example` ریشه و `src/config.mjs`):

| متغیر                                                                             | پیش‌فرض                                    | توضیح                                                                                                    | راز |
| --------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --- |
| `LIA_USERNAME` / `LIA_PASSWORD`                                                   | —                                          | حساب لیاتیم                                                                                              | ✔   |
| `DATABASE_URL`                                                                    | `postgres://lia:…@localhost:5433/lia_sync` | دیتابیس ربات                                                                                             | ✔   |
| `SHOP_REVALIDATE_URL`                                                             | خالی (خاموش)                               | `http://127.0.0.1:<پورت فروشگاه>/api/internal/revalidate`                                                |     |
| `SHOP_REVALIDATE_SECRET`                                                          | خالی (خاموش)                               | همان مقدار `REVALIDATE_SECRET` فروشگاه                                                                   | ✔   |
| `SYNC_MIN_CATALOG_MINUTES` / `SYNC_MIN_HERO_MINUTES` / `SYNC_MIN_DETAILS_MINUTES` | `30` / `15` / `60`                         | کمترین فاصله‌ی مجاز هر وظیفه (پنل و ربات کمتر از آن را رد می‌کنند)؛ **همین نام‌ها در `.env` داشبورد هم** |     |
| `SYNC_PAUSED` / `SYNC_JITTER` / `SYNC_WINDOWS`                                    | خاموش / ±۲۰٪ / روز-عصر-شب                  | پیش‌فرض‌های زمان‌بندی؛ جدول `sync_settings` (پنل/ربات) بر آن‌ها اولویت دارد                              |     |
| `MAX_REQUESTS_PER_RUN`                                                            | `60`                                       | سقف درخواست به لیاتیم در هر اجرا                                                                         |     |
| `REQUEST_PAUSE_MIN_MS` / `REQUEST_PAUSE_MAX_MS`                                   | `1000` / `3000`                            | مکث تصادفی پیش از هر درخواست                                                                             |     |
| `MIN_GAP_MINUTES`                                                                 | `20`                                       | کمترین فاصله‌ی دو اجرا (دستی هم)                                                                         |     |
| `DETAILS_PER_RUN` / `DETAILS_MAX_AGE_DAYS`                                        | `30` / `7`                                 | صفحه‌ی محصول در هر اجرا / هر چند روز یک‌بار دوباره خوانده شود                                            |     |
| `IMAGE_CHECKS_PER_RUN`                                                            | `60`                                       | بررسی عکس‌ها در هر اجرا                                                                                  |     |
| `PRICE_MIN_TOMAN` / `PRICE_MAX_TOMAN`                                             | `1000` / `50000000`                        | بازه‌ی قیمت معقول (تومان)؛ خارج از آن ثبت نمی‌شود                                                        |     |
| `BACKOFF_THRESHOLD`                                                               | `3`                                        | چند پاسخ ۴۲۹/۴۰۳/۵xx پشت‌سرهم تا عقب‌نشینی                                                               |     |
| `BALE_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN`                                           | خالی                                       | ربات‌های پیام‌رسان                                                                                       | ✔   |

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

| دستور                               | چه چیزی را می‌سنجد                                            | نیاز                          |
| ----------------------------------- | ------------------------------------------------------------- | ----------------------------- |
| `npm run check`                     | typecheck، lint، prettier                                     | —                             |
| `npm run check:responsive -- <url>` | همه‌ی صفحه‌ها در ۳۶۰ تا ۱۹۲۰ پیکسل بدون اسکرول افقی           | اپ در حال اجرا                |
| `npm run check:prices -- <url>`     | قیمت‌ها به تومان و برابر قیمت ذخیره‌شده                       | اپ + دیتابیس                  |
| `npm run check:search -- <url>`     | نرمال‌ساز SQL و TS یکی است؛ پیشنهادها فقط فیلدهای عمومی دارند | اپ + دیتابیس                  |
| `npm run test:unit`                 | تخفیف، پک، پرفروش‌ها؛ تابع‌های قیمت ۰۰۹ و ۰۱۰ و دسترسی نقش اپ | Docker محلی (`npm run db:up`) |
| `npm run test:e2e`                  | end-to-end، همه‌ی مجموعه‌ها (جدول پایین)                      | اپ محلی + Docker + Playwright |
| `npm run test:e2e -- budget`        | بودجه‌ی کارایی (JS، وزن، CLS، تعداد عنصر)؛ فقط می‌خواند       | اپ در حال اجرا                |
| `npm run perf -- <url>`             | Lighthouse موبایل و دسکتاپ، میانه‌ی چند اجرا، با تفکیک LCP    | اپ در حال اجرا + Chromium     |
| `npm run font:check`                | حروف متن دیتابیس و رابط که در فونت نیستند                     | دیتابیس                       |

ربات و داشبورد تست‌های خودشان را در ریشه‌ی ریپو دارند (`npm test`).

### تست‌های end-to-end (`tests/e2e/`)

مرورگر واقعی (Playwright) روی اپِ در حال اجرا:

| فایل                                        | پوشش                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.e2e.mjs`                              | ورود با کد، نشست و کوکی، محدودیت شماره و IP، انقضا، قفل بعد از ۱۰ کد اشتباه، نقش‌ها و ۴۰۳، CSRF، خروج، audit log                                                                          |
| `catalog.e2e.mjs`                           | خانه، دسته (تعداد، صفحه‌بندی، مرتب‌سازی، فیلترها)، محصول (قیمت تومان)، جست‌وجو، به‌روز شدن قیمت/موجودی، محصولات مخفی، ریدایرکت‌ها، سئو، عکس‌ها، **هیچ لینک هدر/فوتر/نوار پایین ۴۰۴ نیست** |
| `megamenu.e2e.mjs`                          | ترتیب لیاتیم (از دیتابیس)، باز/بسته شدن با هاور/کلیک/Esc/کلیک بیرون، Tab، لینک‌ها، کشوی موبایل، بدون اسکرول افقی                                                                          |
| `navmenu.e2e.mjs`                           | محصولات منوی دسته و برند فقط هنگام باز شدن بار می‌شوند، کیبورد، عرض‌ها، API فقط فیلدهای عمومی                                                                                             |
| `search.e2e.mjs`                            | پیشنهاد حین تایپ، هایلایت، ي/ك و غلط املایی، ↑/↓/Enter/Esc و «/»، صفحه‌ی نتایج و رتبه‌بندی، مرتب‌سازی، حالت بی‌نتیجه، عرض‌ها                                                              |
| `product.e2e.mjs`، `product-layout.e2e.mjs` | قالب ثابت صفحه‌ی محصول، بخش‌ها و تب‌ها، ویدیو با دکمه‌ی پخش، دیدگاه‌ها، عرض‌ها                                                                                                            |
| `hero.e2e.mjs`                              | اسلایدر صفحه‌ی اصلی: لینک‌ها، دکمه‌ها، نقطه‌ها، کیبورد، پخش خودکار                                                                                                                        |
| `home.e2e.mjs`                              | ترتیب بخش‌های خانه، برندها، پرفروش‌ها و پنل آن، مجله، بنر همکاری، هدر                                                                                                                     |
| `nav.e2e.mjs`                               | لینک‌های هدر، فوتر و نوار پایین                                                                                                                                                           |
| `offers.e2e.mjs`                            | تخفیف‌ها و کمپین‌ها: پنل، کف قیمت، «اجازه‌ی فروش با زیان»، `/offers`                                                                                                                      |
| `packs.e2e.mjs`                             | پک‌ها و روتین پوستی: بخش خانه، صفحه‌ی پک، پنل، کف قیمت                                                                                                                                    |
| `affiliate.e2e.mjs`                         | فرم همکاری در فروش و پنل درخواست‌ها                                                                                                                                                       |
| `revalidate.e2e.mjs`                        | endpoint به‌روزرسانی ربات (نیاز: `E2E_REVALIDATE_SECRET` = `REVALIDATE_SECRET` اپ)                                                                                                        |
| `budget.e2e.mjs`                            | بودجه‌ی کارایی: JS ≤ ۱۹۰KB، وزن ≤ ۱۱۰۰KB، CLS < ۰٫۱، ≤ ۱۴۰۰ عنصر، بدون درخواست محصول/منو هنگام بارگذاری                                                                                   |
| `seo-links.e2e.mjs`                         | لینک‌های دسته و برند در HTML سرور خانه، `/shop`، `/brands` و صفحه‌ی محصول (بدون JS)                                                                                                       |

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

### پیش‌نیازهای سرور **[یک‌بار]**

- **Node.js ≥ 20.9** (`engines` در `package.json`) و npm.
- **PostgreSQL** همان دیتابیس ربات (`lia_sync`) با دسترسی کاربر `postgres` برای فایل‌های قدم ۲. افزونه‌ی `pg_trgm` را فایل `004` با همین کاربر می‌سازد (`CREATE EXTENSION`).
- **HTTPS اجباری:** کوکی نشست `Secure` است (`COOKIE_SECURE=1`، در production اجباری)؛ بدون HTTPS ورود کار نمی‌کند. staging هم HTTPS می‌خواهد (قدم ۶).
- nginx و certbot (قدم ۶)، و ربات و داشبورد طبق `README.md` ریشه (سرویس‌های `liateam-worker`، `liateam-messenger`، `liateam-orders`، `liateam-dashboard` از `dashboard/deploy/`).

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

همه‌ی فایل‌ها تراکنشی‌اند (یا همه‌اش اعمال می‌شود یا هیچ) و هیچ داده‌ای را تغییر نمی‌دهند. رمزها را بسازید (`openssl rand -hex 24`)، فقط در فایل env بگذارید و جای دیگری ننویسید.

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

# ۲-ک. برچسب‌های لیاتیم (پرفروش، محبوب، جدید) برای بخش «پرفروش‌ترین‌ها»؛ جدول قیمتی ندارد و فقط خوانده می‌شود
sudo -u postgres psql lia_sync -f shop-db-roles-011-product-tags.sql

# ۲-ل. روش اعمال تخفیف لیاتیم (همان تخفیف لیاتیم / فقط مازاد): تابع shop_offer_prices_mode. پیش‌نیاز: ربات به‌روز و یک‌بار اجراشده
#      (ستون consumer_discount_percent)؛ وگرنه با پیام روشن متوقف می‌شود
sudo -u postgres psql lia_sync -f shop-db-roles-012-offer-prices-mode.sql

# ۲-ن. حالت «تخفیف همکاری به مشتری» (partner، پیش‌فرض)، سه حالت با نام (partner / consumer / beyond_base)، تابع
#      shop_offer_prices_v3 با پرچم «ویژه» برای «تخفیفات ویژه»، و اصلاح clamped قیمت پک (پک بدون تخفیف هرگز clamped نیست).
#      پیش‌نیاز: ۰۱۲. بعد از ۰۱۳ هم می‌شود اجرا کرد؛ ترتیب بین این دو مهم نیست
sudo -u postgres psql lia_sync -f shop-db-roles-014-partner-pricing.sql

# ۲-ی. سقف درصد تخفیف partner = OUR_BASE_MARGIN_PERCENT (۴)، ستون max_pct در shop_offer_prices_v3، و قیمت پک بدون تخفیف حتی
#      وقتی قیمت خرید یکی از آیتم‌ها نامعلوم است (مجموع آیتم‌ها). پیش‌نیاز: ۰۱۴؛ تکرارپذیر و تراکنشی
sudo -u postgres psql lia_sync -f shop-db-roles-015-partner-percent.sql

# ۲-م. وضعیت همگام‌سازی برای پنل و /health (تابع فقط‌خواندنی shop_sync_status) و محدودیت زمان نقش‌های اپ
sudo -u postgres psql lia_sync -f shop-db-roles-013-sync-status.sql
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

`npm ci` (نه `npm install`): دقیقاً همان نسخه‌های `package-lock.json` نصب می‌شود (از جمله Next.js 16.4.1 با وصله‌ی امنیتی؛ بخش «امنیت»).

**پک‌های اولیه‌ی روتین پوستی [یک‌بار، بعد از اولین `migrate:up`]:** چهار پک (پوست چرب، خشک، مختلط، حساس)، هر کدام پنج مرحله، ۱۰٪ تخفیف. اگر مجموعه از قبل باشد کاری نمی‌کند (ویرایش‌های پنل را هرگز بازنویسی نمی‌کند). انتخاب‌ها پیشنهادی‌اند و کارفرما باید در `/admin/packs` تأییدشان کند:

```bash
sudo -u liateam-shop bash -c 'set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run seed:packs -- --dry'   # فقط نمایش
sudo -u liateam-shop bash -c 'set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run seed:packs'
```

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

### ۹-الف. ربات: کامل کردن داده‌ها و به‌روزرسانی فوری صفحه‌ها **[یک‌بار بعد از نصب؛ revalidate یک‌بار]**

همه با کاربر `liateam` در `/opt/liateam-bot/app` (ربات `.env` خودش را می‌خواند). هر کدام همان مکث‌ها و قواعد sync را دارند:

```bash
cd /opt/liateam-bot/app
# محتوای سنگین محصولاتی که هنوز خوانده نشده‌اند و متن‌هایی که HTML entity خام دارند، بی‌سروصدا (بدون رویداد تغییر).
# خط اول خروجی تعداد باقی‌مانده را می‌گوید («--missing: N products»)؛ تا وقتی N صفر شود دوباره اجرا کنید:
sudo -u liateam npm run details:refresh -- --missing --entities --quiet
# عکس‌های لیاتیم: یک دسته‌ی ۶۰تایی؛ برای همه‌ی عکس‌های بررسی‌نشده: -- --all
sudo -u liateam npm run images:check
# بنرهای صفحه‌ی اصلی همین حالا (به‌جای اجرای بعدی)
sudo -u liateam npm run hero:refresh
# پنجره‌ی فعلی، توقف یا نه، اجرای قبلی/بعدی هر وظیفه؛ و اجراهای ۲۴ ساعت آینده
sudo -u liateam npm run sync:schedule
sudo -u liateam npm run sync:schedule -- --simulate 24
```

**زمان‌بندی (به وقت تهران):** روز ۰۷:۰۰ تا ۱۹:۰۰، عصر ۱۹:۰۰ تا ۲۳:۰۰، شب ۲۳:۰۰ تا ۰۷:۰۰ همیشه خواب (هیچ درخواستی به لیاتیم نمی‌رود). فاصله‌ها، پنجره‌ها و **توقف موقت** از داشبورد ← تنظیمات ← «زمان‌بندی همگام‌سازی» یا ربات ← «⏱ زمان‌بندی» عوض می‌شوند (جزئیات: `README.md` ریشه، «زمان‌بندی»).

**به‌روزرسانی فوری صفحه‌های فروشگاه بعد از هر sync:** یک راز بسازید و **همان مقدار** را در هر دو فایل بگذارید، سپس هر دو را restart کنید:

```bash
openssl rand -hex 32        # مقدار را فقط در دو فایل env بگذارید
# /opt/liateam-shop/env/staging.env:   REVALIDATE_SECRET=<مقدار>
# /opt/liateam-bot/app/.env:           SHOP_REVALIDATE_URL=http://127.0.0.1:3850/api/internal/revalidate
#                                      SHOP_REVALIDATE_SECRET=<همان مقدار>
sudo systemctl restart liateam-shop-staging liateam-worker
```

صفحه‌ها در هر درخواست رندر می‌شوند؛ این فراخوانی داده‌هایی را که فروشگاه در حافظه نگه می‌دارد (مثلاً قیمت‌ها تا ۳۰ ثانیه، پرفروش‌ها تا ۱ دقیقه، واژگان جست‌وجو تا ۱۰ دقیقه) همان لحظه دور می‌ریزد. بدون آن، این داده‌ها تا پایان عمرشان می‌مانند. با راز اشتباه endpoint پاسخ ۴۰۱ می‌دهد و ربات فقط لاگ می‌کند.

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
| ۵     | `sudo systemctl start liateam-shop-images-warm` (یا خودکار با تایمر)            |
| ۶     | هر چند هفته: `npm audit --omit=dev` (بخش «امنیت»)                               |

### پشتیبان‌گیری و بازگشت

**پیش از هر دیپلوی** اسکیمای فروشگاه را بکاپ بگیرید (production را حتماً؛ staging اختیاری). جدول‌های کاتالوگ مال ربات‌اند و فروشگاه آن‌ها را تغییر نمی‌دهد:

```bash
sudo -u postgres pg_dump -n shop_staging -Fc lia_sync > shop_staging-$(date +%F).dump    # production: -n shop
```

**بازگشت کد** (اگر نسخه‌ی جدید مشکل داشت):

```bash
cd /opt/liateam-shop/staging/app && sudo -u liateam-shop git log --oneline -5      # commit قبلی را پیدا کنید
sudo -u liateam-shop git checkout <commit-قبلی>
cd shop && sudo -u liateam-shop npm ci && sudo -u liateam-shop npm run build && sudo systemctl restart liateam-shop-staging
```

اگر آن دیپلوی مایگریشن تازه داشت و نسخه‌ی قبلی با آن کار نمی‌کند، **پیش از** checkout با کد جدید یک مایگریشن برگردانید (`npm run migrate:down`؛ با env همان محیط) و فقط اگر لازم شد از بکاپ برگردانید (`sudo -u postgres pg_restore --clean -n shop_staging -d lia_sync <فایل>`). برای برگشت به شاخه: `git checkout feature/shop && git pull --ff-only`.

### سرعت: Nginx و CDN **[پیشنهاد؛ در کد حل‌شدنی نیست]**

**آنچه در کد انجام شده:**

- عکس‌ها فقط از بهینه‌ساز (`/_next/image`، WebP، کش یک‌هفته‌ای) و گرم‌کردن کش با تایمر.
- اسلاید اول اسلایدر HTML ساده‌ی سرور با `fetchpriority="high"`؛ عکس اسلایدهای بعدی بعد از بارگذاری و بیکار شدن مرورگر.
- بخش‌های زیر صفحه‌ی اول خانه و فوتر با `content-visibility: auto` و ارتفاع جای‌گیر نزدیک به ارتفاع واقعی (چیدمان اولیه‌ی صفحه از ~۱٫۳ ثانیه به ~۰٫۱ ثانیه روی CPU ۴ برابر کندتر؛ CLS خانه ۰٫۰۰۰۱ موبایل / ۰ دسکتاپ).
- فونت زیرمجموعه (۶۸ به‌جای ۱۰۸ کیلوبایت؛ «فونت» در «توسعه‌ی محلی»).
- منوهای هدر محتوایشان را با اولین باز شدن می‌سازند؛ محصولات منو فقط با باز شدن بار می‌شوند. پخش‌کننده‌ی ویدیو فقط با زدن دکمه‌ی پخش.

**عددهای مرجع (سیستم توسعه، نه تعهد):** LCP موبایل صفحه‌ی اصلی، میانه‌ی ۳ اجرا: با throttling واقعی ۳۳۹۲ ← ۲۶۰۵ میلی‌ثانیه، با شبیه‌سازی Lighthouse ۴۹۸۳ ← ۴۳۱۵. روی سرور واقعی عددها به شبکه و CPU سرور بستگی دارند و سیستم توسعه (مخصوصاً موبایل) نوسان زیادی دارد.

**اندازه‌گیری روی staging:** `npm run perf -- https://staging.<دامنه>` (Lighthouse موبایل و دسکتاپ، میانه، با تفکیک LCP؛ `--runs 5`، `--only mobile`، `--pages /,/shop,p426`) `perf` به Chromium مربوط به Playwright نیاز دارد که از `package.json` ریشه‌ی ریپو می‌آید (`npm ci` و `npx playwright install chromium` در ریشه‌ی همان checkout). staging پشت رمز nginx است؛ `perf` را روی خود سرور با `http://127.0.0.1:3850` اجرا کنید (`pN` آدرس محصول را با `DATABASE_URL` همان env پیدا می‌کند؛ بدون آن آدرس‌ها را مستقیم بدهید، مثلاً `--pages /,/shop,/<slug>`). `npm run test:e2e -- budget` (بودجه‌ی JS، وزن، CLS، نبودن درخواست محصول هنگام بارگذاری) فعلاً آدرس محصول نمونه را از دیتابیس Docker محلی می‌خواند، پس روی سیستم توسعه اجرا می‌شود، نه روی سرور.

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
- **ربات:** `SHOP_REVALIDATE_URL` به پورت ۳۸۴۹ و `REVALIDATE_SECRET` جدا برای production. ربات فقط یک آدرس revalidate می‌گیرد؛ بعد از راه‌اندازی production آن را به production ببرید.
- **تایمر عکس:** فایل‌های `liateam-shop-images-warm.*` برای staging نوشته شده‌اند؛ برای production با مسیر `production/` و `production.env` و نام جدا کپی کنید.
- **nginx:** یک سایت جدید روی دامنه‌ی اصلی، بدون رمز عبور و بدون `noindex`. این فایل هنوز ساخته نشده و در فاز ۳ (استقرار روی دامنه‌ی اصلی) می‌آید.

قبل از هر مایگریشن production بکاپ بگیرید:

```bash
sudo -u postgres pg_dump -n shop -Fc lia_sync > shop-$(date +%F).dump
```

## نصب روی سرور اشتراکی (Ubuntu 24.04، Node 20)

برای سروری که سایت‌های دیگر هم رویش اجرا می‌شوند (حدود ۳٫۸ گیگابایت رم بدون swap). قالب‌ها در `deploy/avina/` هستند و هیچ مقدار واقعی، راز یا IP ندارند.

| فایل                                     | کجا روی سرور                                                        |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `avina-shop.service`                     | `/etc/systemd/system/`؛ پورت `127.0.0.1:3861`، رم ≤ ۷۶۸M، CPU ≤ ۸۰٪ |
| `avina-shop-images-warm.{service,timer}` | `/etc/systemd/system/`؛ ساعت ۷ تا ۲۲ تهران، رم ≤ ۲۵۶M               |
| `build-on-server.sh`                     | از `$SRC/shop/deploy/avina/` اجرا می‌شود؛ بیلد در قفس منابع         |
| `nginx-avina-staging.conf`               | یک فایل جدید در `/etc/nginx/sites-available/`                       |
| `avina-shop.env.example`                 | الگوی `/opt/avina-shop/.env`                                        |

**پوشه‌ها:** منبع کد `SRC=/opt/liateam-bot/app` (checkout موجود مخزن؛ `shop/` آن کپی می‌شود) و `/opt/avina-shop` (اپ اجراشده: کپی `shop/`، `.env`، `node_modules`، `.next`، و `.cache` برای npm). کاربر سیستمی `avina` بدون shell و بدون پوشه‌ی خانه.

### قواعد ایمنی

- **فقط افزودن:** هیچ فایل، سرویس یا تنظیم موجود سرور ویرایش، restart یا reload نمی‌شود، جز `nginx reload` بعد از `nginx -t` موفق. هر چیزی که ساخته می‌شود اسم خودش را دارد (`avina-*`).
- **پشتیبان پیش از هر مرحله‌ای که چیزی را عوض می‌کند** (اسکیمای دیتابیس فروشگاه: «پشتیبان‌گیری و بازگشت»).
- **منابع محدود:** سرویس ۷۶۸M و ۸۰٪ CPU؛ بیلد در `systemd-run --scope` با ۱۸۰۰M و یک CPU، `nice 19` و `ionice -c3`، و پیش از شروع اگر `MemAvailable` (از `/proc/meminfo`) کمتر از ۲۰۰۰M یا دیسک آزاد کمتر از ۳G باشد متوقف می‌شود. بیلد را در ساعت کم‌بازدید سایت‌های دیگر اجرا کنید.
- **nginx:** همیشه `sudo nginx -t` و فقط اگر موفق بود `sudo systemctl reload nginx` (هرگز restart).
- **گواهی:** فقط `certbot certonly --webroot` (certbot هیچ فایل nginx را ویرایش نمی‌کند).
- **هر مرحله راه بازگشت دارد** (ستون آخر).

### مراحل

| #   | کار                       | دستور                                                                                                                                                                                                                                                                                           | بازگشت                                                                                                                      |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| ۱   | کاربر سیستمی و پوشه‌ها    | `sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin avina` · `sudo mkdir -p /opt/avina-shop` · `sudo chown avina:avina /opt/avina-shop` · `sudo chmod 750 /opt/avina-shop`                                                                                | `sudo userdel avina` · `sudo rm -rf /opt/avina-shop`                                                                        |
| ۲   | کد                        | مخزن موجود `SRC=/opt/liateam-bot/app`: `sudo -u liateam -H git -C /opt/liateam-bot/app pull --ff-only`                                                                                                                                                                                          | `sudo -u liateam -H git -C /opt/liateam-bot/app reset --keep <commit قبلی>`                                                 |
| ۳   | دیتابیس: نقش‌ها و grantها | قدم ۲ «استقرار» (`shop-db-roles.sql` تا `013`) با کاربر postgres، روی دیتابیس همین سرور                                                                                                                                                                                                         | فایل‌ها فقط نقش و دسترسی می‌سازند؛ `DROP ROLE` نقش‌های ساخته‌شده                                                            |
| ۴   | env                       | `sudo install -o avina -g avina -m 600 /opt/liateam-bot/app/shop/deploy/avina/avina-shop.env.example /opt/avina-shop/.env` و پر کردن آن (`sudo -u avina nano …`)                                                                                                                                | حذف فایل                                                                                                                    |
| ۵   | بیلد                      | `sudo SRC=/opt/liateam-bot/app /opt/liateam-bot/app/shop/deploy/avina/build-on-server.sh` (کد را به `/opt/avina-shop` می‌برد، `npm ci` و `build`؛ با `--prune` وابستگی‌های توسعه را هم برمی‌دارد؛ مایگریشن **نه**)                                                                              | «بازگشت نسخه» پایین                                                                                                         |
| ۵-ب | مایگریشن (یک‌بار-مصرف)    | `read -rs MPW; sudo -u avina env MIGRATION_DATABASE_URL="postgres://<نقش migrator>:$MPW@127.0.0.1:5432/<دیتابیس>" HOME=/opt/avina-shop/.cache bash -c 'cd /opt/avina-shop && set -a && . ./.env && set +a && npm run migrate:up'; unset MPW` (پایین: «مایگریشن یک‌بار-مصرف»)                    | `npm run migrate:down` با همان شکل دستور، و بکاپ                                                                            |
| ۶   | سرویس                     | `sudo cp /opt/liateam-bot/app/shop/deploy/avina/avina-shop.service /etc/systemd/system/` · `sudo systemd-analyze verify /etc/systemd/system/avina-shop.service` (بدون پیام) · `sudo systemctl daemon-reload && sudo systemctl enable --now avina-shop` · `curl -s http://127.0.0.1:3861/health` | `sudo systemctl disable --now avina-shop && sudo rm /etc/systemd/system/avina-shop.service && sudo systemctl daemon-reload` |
| ۷   | nginx، فقط پورت ۸۰        | پایین («nginx و گواهی»)                                                                                                                                                                                                                                                                         | `sudo rm /etc/nginx/sites-enabled/<نام>` ← `nginx -t` ← reload                                                              |
| ۸   | گواهی                     | `sudo certbot certonly --webroot -w /var/www/<نام>-acme -d <دامنه>`                                                                                                                                                                                                                             | `sudo certbot delete --cert-name <دامنه>`                                                                                   |
| ۹   | nginx کامل                | پایین                                                                                                                                                                                                                                                                                           | برگشت به فایل مرحله‌ی ۷ یا حذف لینک ← `nginx -t` ← reload                                                                   |
| ۱۰  | گرم‌کردن عکس              | `sudo cp …/avina-shop-images-warm.{service,timer} /etc/systemd/system/` · `sudo systemd-analyze verify /etc/systemd/system/avina-shop-images-warm.{service,timer}` · `sudo systemctl daemon-reload && sudo systemctl enable --now avina-shop-images-warm.timer`                                 | `sudo systemctl disable --now avina-shop-images-warm.timer` و حذف دو فایل                                                   |
| ۱۱  | پک‌ها و مدیر (یک‌بار)     | `cd /opt/avina-shop && sudo -u avina env HOME=/opt/avina-shop/.cache bash -c 'set -a; . ./.env; set +a; npm run seed:packs && npm run grant-role -- 09xxxxxxxxx admin'`                                                                                                                         | پک‌ها از پنل خاموش می‌شوند                                                                                                  |

**nginx و گواهی** (`<دامنه>` و `<نام>` را جایگزین کنید، مثلاً `staging.example.com` و `avina-staging`):

```bash
T=/opt/liateam-bot/app/shop/deploy/avina/nginx-avina-staging.conf
D=staging.example.com; N=avina-staging
sudo mkdir -p /var/www/$N-acme
sudo htpasswd -c /etc/nginx/$N.htpasswd client                  # رمز را جدا به کارفرما بدهید
# مرحله‌ی ۷: فقط بخش پورت ۸۰ (پیش از گواهی)
sed -n '/# BEGIN-HTTP/,/# END-HTTP/p' $T | sed -e "s/__DOMAIN__/$D/g" -e "s/__NAME__/$N/g" | sudo tee /etc/nginx/sites-available/$N >/dev/null
sudo ln -s /etc/nginx/sites-available/$N /etc/nginx/sites-enabled/$N
sudo nginx -t && sudo systemctl reload nginx
# مرحله‌ی ۸: گواهی
sudo certbot certonly --webroot -w /var/www/$N-acme -d $D
# مرحله‌ی ۹: فایل کامل
sed -e "s/__DOMAIN__/$D/g" -e "s/__NAME__/$N/g" $T | sudo tee /etc/nginx/sites-available/$N >/dev/null
sudo nginx -t && sudo systemctl reload nginx
```

تمدید گواهی را تایمر خود certbot انجام می‌دهد (روش webroot؛ پوشه‌ی `/var/www/<نام>-acme` باید بماند). nginx این سایت `robots.txt` مسدودکننده و `X-Robots-Tag: noindex, nofollow` دارد و همه‌جا جز `/robots.txt` و چالش Let's Encrypt رمز می‌خواهد.

### مایگریشن یک‌بار-مصرف

مایگریشن جزو بیلد نیست و رمز مالک اسکیما در `.env` سرویس نوشته نمی‌شود: فقط در همان یک دستور، از طریق متغیر محیطی، داده می‌شود (`read -rs` آن را از صفحه‌کلید می‌گیرد و در history نمی‌ماند). باقی تنظیم‌ها (`APP_ENV`، `DB_SCHEMA`) از `.env` خوانده می‌شوند:

```bash
read -rs MPW; sudo -u avina env MIGRATION_DATABASE_URL="postgres://<نقش migrator>:$MPW@127.0.0.1:5432/<دیتابیس>" HOME=/opt/avina-shop/.cache bash -c 'cd /opt/avina-shop && set -a && . ./.env && set +a && npm run migrate:up'; unset MPW
```

- **نقش:** همان نقش migrator فایل `shop-db-roles-002-migrator.sql` (`lia_shop_staging_migrator` / `lia_shop_migrator`)، **نه** مالک کل دیتابیس. دلیل: دسترسی خودکار نقش اپ به جدول‌های تازه با `ALTER DEFAULT PRIVILEGES FOR ROLE <migrator>` تعریف شده است؛ جدولی که نقش دیگری (مثلاً مالک دیتابیس) بسازد مال آن نقش می‌شود و نقش اپ به آن دسترسی نمی‌گیرد، پس فروشگاه بعد از مایگریشن خطای دسترسی می‌دهد.
- **ترتیب:** بیلد ← بکاپ اسکیما ← این دستور ← `restart`. اگر انتشار مایگریشن تازه ندارد، `npm run migrate:status` (به همین شکل) هیچ ردیف `… pending` نشان نمی‌دهد و این قدم لازم نیست.
- **بازگشت:** همین دستور با `migrate:down` (یک مایگریشن؛ `-- 2` یعنی دو تا)، و در صورت نیاز بکاپ.

### دیپلوی بعدی و بازگشت نسخه

```bash
sudo -u liateam -H git -C /opt/liateam-bot/app fetch && sudo -u liateam -H git -C /opt/liateam-bot/app pull --ff-only
sudo pg_dump …                                   # بکاپ اسکیمای فروشگاه («پشتیبان‌گیری و بازگشت»)
sudo SRC=/opt/liateam-bot/app /opt/liateam-bot/app/shop/deploy/avina/build-on-server.sh
read -rs MPW; sudo -u avina env MIGRATION_DATABASE_URL="postgres://<نقش migrator>:$MPW@127.0.0.1:5432/<دیتابیس>" HOME=/opt/avina-shop/.cache bash -c 'cd /opt/avina-shop && set -a && . ./.env && set +a && npm run migrate:up'; unset MPW
sudo systemctl restart avina-shop && curl -s http://127.0.0.1:3861/health
sudo systemctl start avina-shop-images-warm
```

**بازگشت:** `sudo -u liateam -H git -C /opt/liateam-bot/app reset --keep <commit قبلی>`، دوباره `build-on-server.sh` و `sudo systemctl restart avina-shop`. اگر نسخه‌ی جدید مایگریشن تازه داشت، پیش از checkout با همان نسخه‌ی جدید `migrate:down` (دستور «مایگریشن یک‌بار-مصرف» با `migrate:down`) و در صورت نیاز بکاپ را برگردانید. اسکریپت بیلد هیچ سرویسی را restart نمی‌کند؛ نسخه‌ی قبلی تا `restart` در حال اجرا می‌ماند، ولی پوشه‌ی `.next` را بیلد جدید جایگزین کرده است، پس restart بعد از بیلد ناموفق را انجام ندهید و اول بیلد را درست کنید.

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

- `200 {"status":"ok", "checks":{"database":{"status":"up","latencyMs":…}, "sync":{"lastOkMinutesAgo":…, "paused":false}}}`
- `503 {"status":"degraded", "checks":{"database":{"status":"down","code":"DB_UNAVAILABLE"}, "sync":{…}}}`
- `sync.lastOkMinutesAgo`: دقیقه از آخرین همگام‌سازی موفق کاتالوگ (از تابع `shop_sync_status`، فایل `013`؛ `null` تا وقتی نصب نشده). وضعیت را تغییر نمی‌دهد: پایش بیرونی خودش آستانه بگذارد (مثلاً بیش از ۹۰ دقیقه در ساعت کاری = هشدار).

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

## قیمت و تخفیف

همه‌ی مبلغ‌ها **تومان** است. قیمت مشتری هر محصول (`pricing.service.ts` و تابع دیتابیسی `shop_offer_prices`، فایل `009`):

1. **پایه:** قیمت مصرف‌کننده‌ی لیاتیم، عیناً همان که در سایت لیاتیم است.
2. **تخفیف لیاتیم** (تنظیم پنل `/admin/settings` ← «روش اعمال تخفیف لیاتیم»؛ توابع `shop_offer_prices_v3` فایل `014` و `shop_offer_prices_mode` فایل `012`؛ پیش‌فرض تا ذخیره‌ی ادمین: `DEFAULT_DISCOUNT_MODE`):
   - **تخفیف همکاری به مشتری (`partner`، پیش‌فرض):** قیمت خط‌خورده = قیمت لیاتیم؛ قیمت مشتری = قیمت لیاتیم × (۱ − درصد)، که درصد = `LEAST(1 − cost/price به دو رقم اعشار، OUR_BASE_MARGIN_PERCENT)` است. **`OUR_BASE_MARGIN_PERCENT` (پیش‌فرض ۴) در این حالت سقف تخفیف نمایشی است**؛ محصولی که همکاری واقعی‌اش کمتر است همان مقدار کمتر را می‌گیرد؛ کف = قیمت خرید (حاشیه‌ی صفر). تخفیف بزرگ‌تر (دستی، کمپین، تخفیف خود لیاتیم) **جایگزین** تخفیف پایه می‌شود، نه جمع؛ زیر قیمت خرید فقط با تیک «فروش با ضرر». «تخفیفات ویژه» فقط محصولاتی را نشان می‌دهد که تخفیف بیشتر از پایه دارند. قیمت پک = مجموع قیمت‌های نهایی آیتم‌ها؛ مجموع خط‌خورده = مجموع قیمت‌های اصلی؛ تخفیف پک اختیاری (پیش‌فرض ۰).
   - **همان تخفیف لیاتیم (پیش‌فرض):** تخفیفی که خود سایت لیاتیم به مشتری نشان می‌دهد (مثلاً «زمانی کوتاه برای انتخابی خاص» ۱۵٪؛ ربات در ستون `consumer_discount_percent` نگه می‌دارد) با همان درصد. محصولی که در لیاتیم تخفیف ندارد با قیمت عادی فروخته می‌شود.
   - **فقط مازاد بر سود پایه:** از تخفیفی که لیاتیم به حساب ما می‌دهد، فقط بخش بیشتر از `OUR_BASE_MARGIN_PERCENT` (۴٪).
   - سود پایه‌ی ما هیچ‌جا به مشتری نشان داده نمی‌شود. تا فایل `012` نصب نشده، فروشگاه با فرمول «مازاد» (فایل `009`) کار می‌کند.
3. **تخفیف دستی** (پنل `/admin/discounts`): درصد (۱ تا ۹۰) یا مبلغ، روی یک محصول، یک دسته (با همه‌ی زیردسته‌ها)، یک برند یا کل فروشگاه، با زمان شروع و پایان؛ از چند تخفیف هم‌زمان، بهترینِ آن برای مشتری اعمال می‌شود. کمپین‌ها (`/admin/campaigns`) بنر و صفحه‌ی `/offers` را می‌سازند.
4. **سقف:** کل تخفیف (عبوری + دستی) از `DISCOUNT_MAX_PERCENT` (۳۰٪) بیشتر نمی‌شود.
5. **کف:** قیمت هرگز از «قیمت خرید + `DISCOUNT_MIN_MARGIN_PERCENT`» (توصیه‌شده ۱٪) پایین‌تر نمی‌رود. پنل تخفیفی را که به کف برسد با پیام «تخفیف بیش از حد مجاز است» رد می‌کند، **بدون هیچ عددی**.
6. **«اجازه‌ی فروش با زیان»** (روی هر تخفیف و هر پک، **پیش‌فرض خاموش**): کف را برمی‌دارد و پیش‌نمایش هشدار «زیر قیمت خرید» می‌دهد (باز هم بدون عدد). **هشدار تجاری:** با این گزینه فروشگاه روی هر فروش ضرر می‌کند؛ تصمیمش با کارفرماست.

**پک‌ها** (`/admin/packs`، تابع `shop_pack_price`، فایل `010`): پیش‌فرض **بدون تخفیف** (۰٪؛ قیمت پک = جمع قیمت روز محصولات، قیمت هر کدام هم دیده می‌شود)؛ تخفیف را فقط ادمین می‌گذارد: درصد از جمع یا قیمت ثابت؛ گرد به بالا تا ۱۰۰ تومان، هرگز بیشتر از جمع؛ همان کف و همان گزینه‌ی زیان. محصول ناموجود یا بی‌قیمت ⇒ پک «فعلاً در دسترس نیست».

**قیمت خرید هرگز بیرون نمی‌آید:** نقش اپ ستون `cost_price` را نمی‌تواند بخواند؛ محاسبه داخل دیتابیس است و اپ فقط قیمت نهایی و یک بله/خیر («به کف رسید») می‌گیرد. `cost_price`، `payable_price`، `discount_price`، درصد سود و هر عدد مشتق از آن‌ها در HTML، JSON، لاگ، پیام ربات و رویداد نمی‌آید (تست‌های e2e در هر صفحه و API بررسی می‌کنند).

## کارایی، کش و همگام‌سازی

### کوئری‌ها و ایندکس‌ها

`EXPLAIN (ANALYZE, BUFFERS)` روی داده‌ی واقعی (۲۲۷ محصول، جدول ۱٫۶ مگابایت) با نقش اپ: فهرست دسته (با زیردرخت)، صفحه‌ی برند، صفحه‌ی محصول، عکس‌ها/مشخصات، جست‌وجو و پیشنهاد، و ردیف‌های قیمت — همه زیر **۳ میلی‌ثانیه** و همه از حافظه (shared hit). اسکن ترتیبی در این اندازه سریع‌ترین برنامه است؛ ایندکس تازه را برنامه‌ریز استفاده نمی‌کند و فقط نوشتن ربات را کند می‌کند، پس **ایندکس جدیدی اضافه نشد**. جدول‌ها مال ربات‌اند (`public`)؛ ایندکس روی آن‌ها با مالک دیتابیس است، نه migrator فروشگاه. **آستانه:** از حدود ۵٬۰۰۰ محصول، با یک فایل `deploy` جدید (مالک): `GIN (category)` و `btree (brand_code)` روی `supplier_products` و دوباره EXPLAIN.

### Pool و محدودیت زمان

| تنظیم                                 | مقدار                                | کجا                                     |
| ------------------------------------- | ------------------------------------ | --------------------------------------- |
| حداکثر اتصال (`DB_POOL_MAX`)          | ۵                                    | `.env`؛ `src/lib/db/pool.ts`            |
| بستن اتصال بیکار                      | ۳۰ ثانیه                             | `pool.ts`                               |
| زمان برقراری اتصال                    | ۵ ثانیه                              | `pool.ts`                               |
| `statement_timeout`                   | ۱۰ ثانیه (`DB_STATEMENT_TIMEOUT_MS`) | هر اتصال؛ و روی خود نقش‌ها (فایل `013`) |
| `idle_in_transaction_session_timeout` | ۳۰ ثانیه                             | روی نقش‌های اپ (فایل `013`)             |

درخواست کندتر از ۱۰ ثانیه با `DB_TIMEOUT` (۵۰۳) پایان می‌یابد و اتصال آزاد می‌شود.

### ظرفیت

**سرور فعلی (۲ vCPU، ۳٫۸ گیگابایت، چند سایت دیگر):** فروشگاه با سقف ۷۶۸ مگابایت و ۸۰٪ یک CPU، و Pool ۵ اتصالی. هر صفحه برای هر درخواست ساخته می‌شود (هدر حالت کاربر را دارد) و هزینه‌اش بیشتر CPU رندر است تا دیتابیس؛ پس سقف عملی با CPU تعیین می‌شود: تخمین ۱۵ تا ۲۵ صفحه در ثانیه، یعنی حدود ۵۰ تا ۱۰۰ کاربر هم‌زمانِ واقعی (هر کاربر هر چند ثانیه یک صفحه) بدون آسیب به سایت‌های دیگر. **سرور دوبرابر (۴ vCPU، ۸ گیگابایت، فقط فروشگاه):** با دو نمونه‌ی اپ پشت nginx (یا `CPUQuota=180%`) و Pool ۱۰، حدود سه برابر: ۵۰ تا ۷۰ صفحه در ثانیه، چند صد کاربر هم‌زمان. هر دو عدد برآوردند؛ عدد واقعی را `npm run load-test` روی همان سرور می‌دهد (`docs/load-test.md`).

### کش و تازه‌سازی (رویداد ربات ← صفحه‌ها)

صفحه‌ها برای هر درخواست ساخته می‌شوند؛ کش‌های کوتاه داخلی: قیمت‌ها ۳۰ ثانیه، منو و دسته‌ها، پک‌ها و پرفروش‌ها. ربات بعد از هر اجرا `POST /api/internal/revalidate` می‌زند؛ هر درخواست معتبر همه‌ی این کش‌ها را پاک می‌کند (`dataChanged`) و مسیرهای زیر را تازه می‌کند. فروشگاه آدرس‌های قدیمی ربات (`/p/<slug>`، `/<slug>`، `/c/<slug>`، `/brands/<slug>`) را به آدرس‌های جدید `/shop/product/<slug>`، `/shop/category/<slug>` و `/shop/brand/<slug>` ترجمه می‌کند. ساختار آدرس‌ها: همه‌ی صفحه‌های فروشگاهی زیر `/shop` هستند و همه‌ی لینک‌ها از `src/lib/urls.ts` ساخته می‌شوند؛ آدرس‌های قدیمی با یک ریدایرکت ۳۰۱ (بدون زنجیره) به آدرس جدید می‌روند.

| رویداد (`change_events.event_type`)                                                                                                                    | صفحه‌ها                                                        | از کجا  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------- |
| هر رویداد محصول                                                                                                                                        | صفحه‌ی همان محصول (`/<slug>`؛ بدون slug: همه‌ی صفحه‌های محصول) | ربات    |
| `price_changed`، `stock_changed`، `product_added`، `product_removed`، `product_returned`، `name_changed`، `images_changed`                             | `/`، `/shop`، `/search`، همه‌ی صفحه‌های دسته و برند            | ربات    |
| همان‌ها (وقتی `/shop` در فهرست است)                                                                                                                    | `/offers`، `/categories`، `/brands`، همه‌ی صفحه‌های پک         | فروشگاه |
| `banner_changed`                                                                                                                                       | `/`                                                            | ربات    |
| `description_changed`، `features_changed`، `specs_changed`، `how_to_use_changed`، `video_changed`، `faq_changed`، `reviews_changed`، `gallery_changed` | فقط صفحه‌ی همان محصول                                          | ربات    |
| تأیید دیدگاه در پنل                                                                                                                                    | همه‌ی صفحه‌های محصول                                           | فروشگاه |

آخرین تازه‌سازی در پنل (کارت «وضعیت همگام‌سازی» در `/admin`) دیده می‌شود.

### وضعیت همگام‌سازی در پنل

`/admin` ← «وضعیت همگام‌سازی»: آخرین همگام‌سازی کاتالوگ و وضعیتش، آخرین اجرای موفق، شمار محصولات قابل نمایش، رویدادهای ۲۴ ساعت اخیر، آخرین revalidate و «متوقف / در حال اجرا»ی زمان‌بندی (کلید `paused` داشبورد؛ توقف از env ربات اینجا دیده نمی‌شود). همه از تابع فقط‌خواندنی `shop_sync_status()` (فایل `013`): فقط عدد و زمان، بدون متن رویداد و قیمت؛ نقش اپ به جدول‌های ربات دسترسی ندارد.

## امنیت

- **Next.js 16.4.1:** وصله‌ی هشدارهای GHSA-2464-fhr4-w9xw (بحرانی؛ اجرای کد از راه دور در بهینه‌ساز عکس با SVG)، GHSA-673q-mjm6-r5xr (بحرانی؛ اجرای کد از راه دور در توابع `use cache`) و GHSA-p3m5-59mp-jv5r / CVE-2026-94482 (بالا؛ از کار انداختن سرویس با Server Actions). نسخه‌ی ۱۶٫۴٫۰ آسیب‌پذیر است.
- **نصب فقط با `npm ci`** (نسخه‌های دقیق lockfile). **هر چند هفته** `npm audit --omit=dev` در `shop/`؛ مورد high/critical را با به‌روزرسانی کوچک همان خط رفع کنید. هشدارهای وابستگی‌های توسعه (زنجیره‌ی Lighthouse برای `perf`) روی سرور اجرا نمی‌شوند.
- **ویدیو:** فقط پخش‌کننده‌ی ArvanCloud لیاتیم (آدرس با الگوی ثابت دوباره بررسی می‌شود)، در iframe با `sandbox`، و فقط بعد از زدن دکمه‌ی پخش بار می‌شود.
- **عکس‌ها** فقط از بهینه‌ساز خود فروشگاه (`/_next/image`)؛ مرورگر هرگز مستقیم به سرور تأمین‌کننده نمی‌رود.
- **متن‌ها:** ربات همه‌ی HTML لیاتیم را به متن ساده تبدیل می‌کند؛ دیدگاه‌ها و فرم همکاری متن کاربر را پاک‌سازی می‌کنند (برچسب‌ها، کاراکترهای کنترلی و جهت‌دهی) و فروشگاه همه را به‌صورت متن (escape‌شده) نمایش می‌دهد، نه HTML.
- **دیتابیس:** نقش اپ فقط SELECT / INSERT / UPDATE در اسکیمای خودش (**بدون DELETE**؛ ردیف‌ها خاموش می‌شوند، حذف نمی‌شوند) و خواندن کاتالوگ بدون `cost_price`. `audit_log` فقط افزودنی است.
- **رازها** فقط در فایل‌های env سرور (`600`)؛ لاگر رازها را پاک می‌کند.
- **ورود و فرم‌ها:** بخش «احراز هویت»؛ همه‌ی Server Actionها Origin را بررسی می‌کنند (CSRF).

## کاتالوگ

| مسیر                          | صفحه                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                           | خانه، به ترتیب: اسلایدر بنرهای لیاتیم، دایره‌های دسته‌های اصلی، تخفیفات ویژه، برندها، پرفروش‌ترین‌ها (تب‌ها)، روتین پوستی، مجله («به‌زودی»)، بنر همکاری در فروش |
| `/shop`                       | همه‌ی محصولات با فیلتر و مرتب‌سازی                                                                                                                              |
| `/categories`                 | همه‌ی دسته‌ها و زیردسته‌ها                                                                                                                                      |
| `/c/173-…`                    | دسته (همراه همه‌ی زیردسته‌هایش) · فیلتر زیردسته و «فقط موجود» · مرتب‌سازی · صفحه‌بندی                                                                           |
| `/brands`، `/brands/<slug>`   | فهرست برندها و صفحه‌ی هر برند با محصولاتش                                                                                                                       |
| `/<slug>`                     | محصول با قالب ثابت: گالری، ستون اطلاعات (برند، حجم، کشور، ویژگی‌های کلیدی)، کارت خرید؛ تب‌های معرفی، مشخصات، نحوه مصرف، پرسش‌ها، دیدگاه‌ها؛ ویدیو با دکمه‌ی پخش |
| `/offers`                     | محصولات تخفیف‌دار و کمپین فعال                                                                                                                                  |
| `/packs/<مجموعه>/<نوع>`       | پک (مثلاً `/packs/skin-routine/oily`): مرحله‌ها، جمع قیمت محصولات، قیمت پک و صرفه‌جویی                                                                          |
| `/affiliate`                  | همکاری در فروش: فرم درخواست                                                                                                                                     |
| `/search?q=…`                 | جست‌وجو در نام و برند: جزئی، خطاپذیر (غلط املایی، ي/ك عربی، نیم‌فاصله)، مرتب بر اساس ربط؛ پیشنهاد لحظه‌ای از `GET /api/search/suggest`؛ بدون `q` همه‌ی محصولات  |
| `/login`، `/account`          | ورود با کد پیامکی؛ حساب کاربر                                                                                                                                   |
| `/admin/…`                    | فقط نقش admin: `reviews` (تأیید دیدگاه‌ها)، `affiliates` (درخواست‌های همکاری)، `discounts` و `campaigns`، `packs`، `bestsellers`                                |
| `/cart`، `/account/wallet`، … | صفحه‌ی «به‌زودی» (فاز ۲)                                                                                                                                        |

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

## لایه‌ی دیتابیس سفارش (فاز ۲)

فقط مدل داده، سطح دسترسی، repository و تست؛ هنوز UI یا API ندارد و روی سرور اعمال نشده است.

**ترتیب اعمال روی هر سرور:** ۱) دیپلوی ربات با `needs_review` و ری‌استارت سرویس `liateam-orders` (ستون `shop_orders.origin` را هنگام راه‌اندازی می‌سازد)؛ ۲) `sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-016-orders.sql`؛ ۳) `npm run migrate:up`.

| جدول (schema فروشگاه) | کار |
|---|---|
| `carts` / `cart_items` | سبد مهمان (هش توکن) و کاربر؛ ادغام بعد از ورود؛ قیمت ذخیره نمی‌شود |
| `addresses` (ستون‌های تازه) | `province_id`، `city_id` لیاتیم، `plate`، `unit` |
| `orders` / `order_items` | سفارش، شماره‌ی خوانا `AV-100001`، کلید idempotency، عکس لحظه‌ای قیمت فروش و تخفیف، نتیجه‌ی اعتبارسنجی زنده، `bot_order_id` (یک‌به‌یک با `shop_orders` ربات) |
| `order_events` | رویدادها، فقط افزودنی |
| `payments` | هر سفارش فقط یک‌بار تأیید می‌شود (ایندکس یکتا) |
| `wallet_ledger` | کیف پول: دفتر فقط‌افزودنی؛ موجودی منفی نمی‌شود؛ کلید idempotency هر ردیف |
| `affiliate_codes` / `affiliate_referrals` / `commission_rules` / `commissions` | معرف، قوانین (خالی)، پورسانت |
| `shipping_methods` / `shipping_rules` / `sms_log` | برچسب و زمان ارسال، لاگ پیامک (بدون متن) |

وضعیت سفارش: `pending_payment → queued → placing → awaiting_payment → supplier_paid → sent` و `needs_review`، `refunded`، `canceled`. جدول گذارها در `src/lib/orders/status.ts` و تابع `order_status_can_move` است و یک تست آن دو را مقایسه می‌کند.

**تنظیمات** (`site_settings`): `orders.price_tolerance_toman` (۱۰)، `orders.auto_place_enabled` (خاموش)، `orders.auto_place_hours`، `shipping.free_enabled` (خاموش)، `shipping.free_from_toman` (۹۹۹٬۰۰۰). با خاموش بودن ارسال رایگان، خط «ارسال رایگان…» در هدر نمایش داده نمی‌شود. وقتی روشن باشد و جمع کالا به آستانه برسد، مشتری ارسال را ۰ می‌بیند ولی سفارش `shipping_supplier_price` (قیمت لیاتیم)، `shipping_charged` و `shipping_absorbed` را جدا نگه می‌دارد.

**صف ربات:** نقش اپ به جدول‌های ربات دسترسی مستقیم ندارد؛ فقط توابع `shop_enqueue_review`، `shop_review_result`، `shop_enqueue_create`، `shop_create_result`، `shop_enqueue_place` و `SELECT` روی چند ستون `public.shop_orders` و `public.shop_order_items` (بدون `unit_cost`، `liateam_total`، `last_error`، `dry_run_result` و بدون `shop_order_events`).
