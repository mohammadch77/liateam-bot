# نصب staging فروشگاه روی سرور فعلی (حالت IP)

**سرور:** Ubuntu 24.04 · Node 20.20 · PostgreSQL 16 · Nginx 1.24 · رم ۳٫۸ گیگابایت بدون swap · حدود ۸ گیگابایت دیسک آزاد · `193.242.208.208` · SSH پورت `9011` با root.

**دست نخوردنی‌ها:** getstock/mediajet (پورت ۳۰۰۰ و Nginx آن)، ربات رزرو کتابخانه (`127.0.0.1:18080`)، داشبورد لیاتیم (۳۸۴۷ / ۸۴۴۳)، **ربات و داشبورد لیاتیم** (سرویس‌های `liateam-*`؛ در این به‌روزرسانی کدشان تغییری ندارد، پس نه `npm ci`، نه build، نه restart)، همه‌ی فایل‌های موجود `/etc/nginx`، و هر سرویس دیگر. این سند فقط **فایل جدید** می‌سازد. تنها کارها روی چیزهای موجود: `git pull` مخزن (قدم ۲)، توقف موقت/ادامه‌ی زمان‌بندی ربات برای بک‌فیل (قدم ۳)، `nginx reload` بعد از `nginx -t` موفق (قدم ۹)، و افزودن دو خط revalidate به `.env` ربات با یک restart کوتاه worker (قدم ۱۰، اختیاری).

**پیش‌نیاز:** commitهای این سند و `deploy/avina/` روی GitHub push شده باشند (شاخه‌ی `feature/shop`). پشتیبان nginx و `lia_sync` در `/root/backups` هست.

**قواعد پیست:** هر دستور یک خط است؛ با root در SSH اجرا کنید (`ssh -p 9011 root@193.242.208.208`). جایی که `read -rs` آمده، مقدار را تایپ یا پیست کنید و Enter بزنید (روی صفحه نمایش داده نمی‌شود و در history نمی‌ماند). جایی که «بررسی کن» آمده، اول خروجی را ببینید و بعد ادامه دهید.

**نشانی‌های این سند:** کد (منبع) `SRC=/opt/liateam-bot/app` (کاربر `liateam`؛ پوشه‌ی `shop/` داخل آن) · اپ فروشگاه `/opt/avina-shop` (کاربر `avina`) · پورت فروشگاه `127.0.0.1:3861` · staging بیرونی `https://193.242.208.208:8444`.

---

## ۱. کاربر avina و پوشه‌ی اپ

**هدف:** کاربر سیستمی جدا، بدون shell و بدون پوشه‌ی خانه، و پوشه‌ی اپ با مالک خودش. (کد از همان مخزن موجود `/opt/liateam-bot/app` می‌آید؛ clone دوم لازم نیست.)

```bash
id avina || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin avina
mkdir -p /opt/avina-shop && chown avina:avina /opt/avina-shop && chmod 750 /opt/avina-shop
id avina && ls -ld /opt/avina-shop
```

**خروجی:** `uid=… (avina) gid=… (avina)` و `drwxr-x--- … avina avina … /opt/avina-shop`.
**بازگشت:** `rm -rf /opt/avina-shop && userdel avina`.

---

## ۲. به‌روزرسانی کد (با کاربر liateam)

**هدف:** مخزن روی آخرین commit شاخه‌ی `feature/shop`، بدون دست زدن به تغییر محلی `dashboard/package-lock.json`.

```bash
sudo -u liateam -H git -C /opt/liateam-bot/app status --short
sudo -u liateam -H git -C /opt/liateam-bot/app log --oneline -3
sudo -u liateam -H git -C /opt/liateam-bot/app fetch origin
sudo -u liateam -H git -C /opt/liateam-bot/app log --oneline HEAD..origin/feature/shop
sudo -u liateam -H git -C /opt/liateam-bot/app diff --stat HEAD origin/feature/shop -- src scripts dashboard package.json package-lock.json
sudo -u liateam -H git -C /opt/liateam-bot/app rev-parse HEAD > /root/backups/liateam-app-before-pull.txt
sudo -u liateam -H git -C /opt/liateam-bot/app pull --ff-only
```

**خروجی مورد انتظار:**

- `status` فقط ` M dashboard/package-lock.json` (و شاید فایل‌های untracked) نشان می‌دهد.
- `log HEAD..origin/feature/shop` فهرست commitهای جدید را نشان می‌دهد.
- `diff --stat … src scripts dashboard package.json package-lock.json` **خالی** است: ربات و داشبورد در این pull تغییری ندارند و دست نمی‌خورند. **بررسی کن:** اگر خالی نبود، ادامه ندهید و با مجری هماهنگ کنید (به‌روزرسانی ربات/داشبورد مرحله‌ی جدایی است).
- `pull --ff-only`: `Fast-forward`.

**اگر `pull` خطا داد:**

- `Your local changes … would be overwritten`: commitهای جدید همان `dashboard/package-lock.json` را تغییر داده‌اند. **ادامه ندهید و فایل را دور نریزید**؛ تغییر محلی را با `sudo -u liateam -H git -C /opt/liateam-bot/app diff dashboard/package-lock.json > /root/backups/dashboard-lock-local.diff` ذخیره و با مجری هماهنگ کنید.
- `Not possible to fast-forward`: تاریخچه‌ی محلی جدا شده؛ ادامه ندهید و با مجری هماهنگ کنید.

**بازگشت:** `sudo -u liateam -H git -C /opt/liateam-bot/app reset --keep "$(cat /root/backups/liateam-app-before-pull.txt)"` (`--keep` تغییر محلی lock را نگه می‌دارد). چون ربات و داشبورد ری‌استارت نشده‌اند، با همان کد در حافظه کار می‌کنند.

---

## ۳. ربات: بررسی و بک‌فیل محتوا (بدون ری‌استارت)

**هدف:** وضعیت زمان‌بندی و رویدادها را ببینید و محتوای محصولاتی را که هنوز خوانده نشده‌اند بی‌سروصدا کامل کنید. کد ربات و سرویس‌هایش دست نمی‌خورند.

```bash
sudo -u liateam -H bash -c 'cd /opt/liateam-bot/app && npm run sync:schedule'
sudo -u liateam -H bash -c 'cd /opt/liateam-bot/app && npm run events:list -- 20'
```

**خروجی:** پنجره‌ی فعلی (روز / عصر / شب)، «متوقف» یا نه، اجرای قبلی و بعدی هر وظیفه؛ و آخرین رویدادهای تغییر (بدون هیچ قیمت خرید).

**بک‌فیل (با توقف موقت):**

۱. داشبورد ← تنظیمات ← «زمان‌بندی همگام‌سازی» ← **«توقف موقت»** (یا ربات ← «⏱ زمان‌بندی» ← توقف). `npm run sync:schedule` باید «متوقف» نشان دهد.
۲. بک‌فیل (هر صفحه با مکث ۱ تا ۳ ثانیه؛ بدون رویداد تغییر):

```bash
sudo -u liateam -H bash -c 'cd /opt/liateam-bot/app && npm run details:refresh -- --missing --entities --quiet'
```

**خروجی:** خط اول `--missing: N products`. تا وقتی **N صفر** شود همین دستور را دوباره اجرا کنید.
۳. (اختیاری) عکس‌ها و بنرها: `sudo -u liateam -H bash -c 'cd /opt/liateam-bot/app && npm run images:check'` و `sudo -u liateam -H bash -c 'cd /opt/liateam-bot/app && npm run hero:refresh'`.
۴. داشبورد ← **«ادامه»**. `npm run sync:schedule` دیگر «متوقف» نشان نمی‌دهد.

**بازگشت:** بک‌فیل فقط متن محصولات را از لیاتیم دوباره می‌خواند؛ برگرداندن لازم ندارد (پشتیبان `lia_sync` در `/root/backups`). اگر «ادامه» فراموش شود ربات هیچ sync خودکاری انجام نمی‌دهد: حتماً بند ۴.

---

## ۴. دیتابیس فروشگاه (با کاربر postgres)

**هدف:** نقش‌ها و اسکیماهای فروشگاه، `pg_trgm` و دسترسی‌ها روی `lia_sync`. رمزها با `read -rs` وارد می‌شوند و در سند و history نمی‌آیند.

**بررسی کن (آیا قبلاً ساخته شده‌اند؟):**

```bash
sudo -u postgres psql lia_sync -tAc "select rolname from pg_roles where rolname like 'lia_shop%' order by 1"
sudo -u postgres psql lia_sync -tAc "select extname from pg_extension where extname = 'pg_trgm'"
```

اگر چهار نقش `lia_shop`، `lia_shop_migrator`، `lia_shop_staging`، `lia_shop_staging_migrator` **وجود دارند**، ۴-الف و ۴-ب را رد کنید (این دو فایل تکرارپذیر نیستند و با نقش موجود خطا می‌دهند؛ چیزی هم تغییر نمی‌کند چون تراکنشی‌اند). رمز نقش‌های موجود را با مجری هماهنگ کنید.

### ۴-الف. نقش‌های اپ و اسکیماها

چهار رمز بسازید (جایی امن یادداشت کنید؛ در قدم ۵ و ۷ لازم‌اند):

```bash
openssl rand -hex 24
```

(چهار بار: اپ staging، اپ production، migrator staging، migrator production.)

```bash
read -rs SPW; read -rs PPW; sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -v staging_pw="'$SPW'" -v prod_pw="'$PPW'" -f /opt/liateam-bot/app/shop/deploy/shop-db-roles.sql; unset SPW PPW
```

**خروجی:** `CREATE ROLE`، `CREATE SCHEMA`، `GRANT`، `COMMIT`.

### ۴-ب. نقش‌های migrator (مالک اسکیمای فروشگاه)

```bash
read -rs SPW; read -rs PPW; sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -v staging_pw="'$SPW'" -v prod_pw="'$PPW'" -f /opt/liateam-bot/app/shop/deploy/shop-db-roles-002-migrator.sql; unset SPW PPW
```

### ۴-ج. دسترسی‌های کاتالوگ، جست‌وجو (pg_trgm) و توابع قیمت (۰۰۳ تا ۰۱۱؛ تکرارپذیر)

```bash
sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -f /opt/liateam-bot/app/shop/deploy/shop-db-roles-003-catalog-details.sql
sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -f /opt/liateam-bot/app/shop/deploy/shop-db-004-search.sql
sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -f /opt/liateam-bot/app/shop/deploy/shop-db-roles-005-rich-content.sql
sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -f /opt/liateam-bot/app/shop/deploy/shop-db-roles-006-gallery.sql
sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -f /opt/liateam-bot/app/shop/deploy/shop-db-roles-007-hero.sql
sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -f /opt/liateam-bot/app/shop/deploy/shop-db-roles-008-product-facts.sql
sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -f /opt/liateam-bot/app/shop/deploy/shop-db-roles-009-offer-prices.sql
sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -f /opt/liateam-bot/app/shop/deploy/shop-db-roles-010-pack-prices.sql
sudo -u postgres psql lia_sync -v ON_ERROR_STOP=1 -f /opt/liateam-bot/app/shop/deploy/shop-db-roles-011-product-tags.sql
sudo -u postgres psql lia_sync -tAc "select extname from pg_extension where extname = 'pg_trgm'"
```

**خروجی:** هر فایل بدون `ERROR`؛ خط آخر `pg_trgm`. اگر ۰۰۳ یا ۰۰۵ گفت ربات هنوز با کد لازم sync نکرده، ادامه ندهید و با مجری هماهنگ کنید.
**بازگشت:** همه تراکنشی‌اند (خطا = هیچ تغییر). برای حذف کامل فروشگاه از دیتابیس: پشتیبان `/root/backups` یا با مجری (`DROP SCHEMA shop_staging CASCADE` و حذف نقش‌ها) — جدول‌های ربات تغییری نمی‌کنند.

---

## ۵. ‎.env فروشگاه

**هدف:** فایل env با مجوز ۶۰۰ و مالک avina. رمز migrator **در این فایل نمی‌آید** (قدم ۷).

```bash
install -o avina -g avina -m 600 /opt/liateam-bot/app/shop/deploy/avina/avina-shop.env.example /opt/avina-shop/.env
nano /opt/avina-shop/.env
ls -l /opt/avina-shop/.env
```

**مقدارها (هیچ‌کدام را در سند یا جای دیگری ننویسید):**

| متغیر                          | مقدار / منبع                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                      | `staging`                                                                                                                                                |
| `PORT`                         | `3861` (در قالب هست)                                                                                                                                     |
| `DATABASE_URL`                 | `postgres://lia_shop_staging:<رمز اپ staging از ۴-الف>@127.0.0.1:5432/lia_sync` — **بررسی کن** پورت PostgreSQL: `sudo -u postgres psql -tAc "show port"` |
| `DB_SCHEMA`                    | `shop_staging`                                                                                                                                           |
| `BRAND_NAME`                   | نام فارسی (فعلاً `آوینا`)                                                                                                                                |
| `BRAND_LATIN`، `SUPPORT_PHONE` | اختیاری؛ از کارفرما                                                                                                                                      |
| `AUTH_SECRET`                  | `openssl rand -hex 32` (جدید، فقط برای staging)                                                                                                          |
| `COOKIE_SECURE`                | `1` (HTTPS با گواهی خودامضا هم کافی است)                                                                                                                 |
| `TRUST_PROXY`                  | `1` (پشت nginx قدم ۹)                                                                                                                                    |
| `DISCOUNT_MIN_MARGIN_PERCENT`  | `1` (در قالب هست)                                                                                                                                        |
| `SMS_PROVIDER`                 | `dev` تا کلید کاوه‌نگار (کد ورود در لاگ)                                                                                                                 |
| `REVALIDATE_SECRET`            | فعلاً کامنت بماند؛ قدم ۱۰                                                                                                                                |
| بقیه                           | کامنت بمانند (مقدار خالی یعنی صفر، نه پیش‌فرض)                                                                                                           |

**خروجی:** `-rw------- 1 avina avina … /opt/avina-shop/.env`.
**بازگشت:** `rm /opt/avina-shop/.env`.

---

## ۶. بیلد فروشگاه در قفس منابع

**هدف:** `$SRC/shop` به `/opt/avina-shop` کپی و آنجا `npm ci` و `build` با کاربر avina، داخل `systemd-run --scope` (MemoryMax=1800M، CPUQuota=100%)، `nice 19`، `ionice -c3`، `NODE_OPTIONS=--max-old-space-size=1500`. اسکریپت پیش از شروع `MemAvailable` از `/proc/meminfo` (≥ ۲۰۰۰ مگابایت) و دیسک آزاد (≥ ۳ گیگابایت) را چک می‌کند، **مایگریشن اجرا نمی‌کند** و هیچ سرویسی را ری‌استارت نمی‌کند. منبع پیش‌فرض اسکریپت همان `SRC=/opt/liateam-bot/app` است.

**بررسی کن** (ابزارها و منابع):

```bash
command -v rsync systemd-run runuser ionice
grep MemAvailable /proc/meminfo && df -h /opt
```

اگر `rsync` نبود: `apt-get install -y rsync` (فقط یک بسته‌ی جدید؛ چیزی را عوض نمی‌کند).

```bash
SRC=/opt/liateam-bot/app /opt/liateam-bot/app/shop/deploy/avina/build-on-server.sh
grep MemAvailable /proc/meminfo && df -h /opt
```

**خروجی:** `build-on-server: MemAvailable … MB (min 2000), free disk … MB (min 3072)`، سپس `npm ci`، `✓ Compiled successfully`، و در آخر `build-on-server: done.` بعد از بیلد، `MemAvailable` دوباره نزدیک مقدار پیش از بیلد است.

- اگر گفت `not enough available memory`: سایت‌های دیگر الان رم را گرفته‌اند؛ در ساعت خلوت دوباره. (اگر با مجری توافق شد، حد را پایین‌تر بیاورید: `MIN_FREE_MB=1600 SRC=/opt/liateam-bot/app /opt/liateam-bot/app/shop/deploy/avina/build-on-server.sh` — قفس ۱۸۰۰ مگابایت همچنان سقف است.)
- **اگر OOM شد** (`Killed`، `exit code 137` یا `JavaScript heap out of memory`): قفس فقط خود بیلد را کشته؛ سرویس‌های دیگر دست نخورده‌اند (`systemctl --failed` را ببینید). فروشگاه هنوز نصب نشده یا با بیلد قبلی است: **ری‌استارت نکنید**؛ در ساعت خلوت دوباره اجرا کنید.

**بازگشت:** کد قبلی (قدم ۲) و همین اسکریپت.

---

## ۷. مایگریشن (یک‌بار-مصرف) و پک‌های اولیه

**هدف:** جدول‌های فروشگاه در `shop_staging`. اتصال مالک اسکیما فقط در همین یک دستور و از طریق متغیر محیطی داده می‌شود (رمز با `read -rs`)؛ در `.env` سرویس نمی‌ماند.

**نقش:** migrator staging (`lia_shop_staging_migrator`، رمز از ۴-الف)، **نه** مالک کل دیتابیس. دلیل: دسترسی خودکار نقش اپ (`lia_shop_staging`) به جدول‌های تازه با `ALTER DEFAULT PRIVILEGES FOR ROLE lia_shop_staging_migrator` تعریف شده (فایل ۰۰۲)؛ جدولی که نقش دیگری بسازد مال آن نقش است و نقش اپ به آن دسترسی نمی‌گیرد.

```bash
read -rs MPW; runuser -u avina -- env MIGRATION_DATABASE_URL="postgres://lia_shop_staging_migrator:$MPW@127.0.0.1:5432/lia_sync" HOME=/opt/avina-shop/.cache bash -c 'cd /opt/avina-shop && set -a && . ./.env && set +a && npm run migrate:up'; unset MPW
```

**خروجی:** فهرست مایگریشن‌های اجراشده (بار اول همه). خطای اتصال یا رمز: رمز و قدم ۴-ب را بررسی کنید.
**بازگشت:** همین دستور با `migrate:down` به‌جای `migrate:up`، و پشتیبان.

**پک‌های اولیه (یک‌بار):**

```bash
runuser -u avina -- env HOME=/opt/avina-shop/.cache bash -c 'cd /opt/avina-shop && set -a && . ./.env && set +a && npm run seed:packs -- --dry'
runuser -u avina -- env HOME=/opt/avina-shop/.cache bash -c 'cd /opt/avina-shop && set -a && . ./.env && set +a && npm run seed:packs'
```

**خروجی:** چهار پک (چرب، خشک، مختلط، حساس) با انتخاب هر مرحله؛ پک حساس مرحله‌ی کرم را «به‌زودی» دارد. اگر مجموعه از قبل باشد کاری نمی‌کند.
**بازگشت:** پک‌ها از پنل `/admin/packs` خاموش می‌شوند.

---

## ۸. سرویس فروشگاه و تایمر گرم‌کردن عکس

**تأیید روی سرور:** بعد از هر `cp` فایل unit، `systemd-analyze verify` و فقط اگر پیامی نداد `daemon-reload`.

```bash
cp /opt/liateam-bot/app/shop/deploy/avina/avina-shop.service /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/avina-shop.service
systemctl daemon-reload && systemctl enable --now avina-shop
systemctl is-active avina-shop && curl -s http://127.0.0.1:3861/health
systemctl show avina-shop -p MemoryMax -p CPUQuotaPerSecUSec
```

**خروجی:** `verify` بدون پیام؛ `active`؛ `{"status":"ok",…}`؛ `MemoryMax=805306368` و `CPUQuotaPerSecUSec=800ms`. اگر `/health` جواب نداد: `journalctl -u avina-shop --since "-5min" --no-pager` (خطای env با فهرست نام متغیرها می‌آید).

```bash
cp /opt/liateam-bot/app/shop/deploy/avina/avina-shop-images-warm.service /opt/liateam-bot/app/shop/deploy/avina/avina-shop-images-warm.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/avina-shop-images-warm.service /etc/systemd/system/avina-shop-images-warm.timer
systemctl daemon-reload && systemctl enable --now avina-shop-images-warm.timer
systemctl list-timers avina-shop-images-warm.timer --no-pager
systemctl start avina-shop-images-warm && journalctl -u avina-shop-images-warm --since "-5min" --no-pager | tail -5
```

**خروجی:** `verify` بدون پیام؛ تایمر با اجرای بعدی بین ۰۷ و ۲۲ تهران؛ اجرای دستی `[images:warm] … resized …` (بین ۲۳ تا ۰۷ پیام `quiet window: skipped`).
**بازگشت:** `systemctl disable --now avina-shop-images-warm.timer avina-shop` سپس `rm /etc/systemd/system/avina-shop.service /etc/systemd/system/avina-shop-images-warm.service /etc/systemd/system/avina-shop-images-warm.timer && systemctl daemon-reload`.

---

## ۹. Nginx حالت IP (پورت ۸۴۴۴، گواهی خودامضا)

**هدف:** یک فایل جدید `sites-available/avina-staging` از روی قالب `nginx-avina-staging.conf` (بخش پورت ۸۰ حذف، ۴۴۳ ← ۸۴۴۴، گواهی خودامضا)؛ Basic Auth، `X-Robots-Tag noindex`، `robots.txt` مسدودکننده، gzip و کش `/_next/static`. هیچ فایل موجود nginx عوض نمی‌شود.
**تأیید روی سرور:** همیشه `nginx -t`، و فقط اگر `test is successful` گفت `systemctl reload nginx` (هرگز restart).

**بررسی کن** (پورت آزاد است):

```bash
ss -ltnp | grep -E ':8444\b' || echo "8444 free"
ls /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
```

```bash
mkdir -p /etc/nginx/ssl && chmod 700 /etc/nginx/ssl
openssl req -x509 -nodes -newkey rsa:2048 -days 365 -subj "/CN=193.242.208.208" -addext "subjectAltName=IP:193.242.208.208" -keyout /etc/nginx/ssl/avina-staging.key -out /etc/nginx/ssl/avina-staging.crt
chmod 600 /etc/nginx/ssl/avina-staging.key
printf 'client:%s\n' "$(openssl passwd -apr1)" > /etc/nginx/avina-staging.htpasswd && chmod 640 /etc/nginx/avina-staging.htpasswd && chgrp www-data /etc/nginx/avina-staging.htpasswd
sed -e '/# BEGIN-HTTP/,/# END-HTTP/d' -e 's/listen 443 ssl http2;/listen 8444 ssl http2;/' -e 's/listen \[::\]:443 ssl http2;/listen [::]:8444 ssl http2;/' -e 's#/etc/letsencrypt/live/__DOMAIN__/fullchain.pem#/etc/nginx/ssl/avina-staging.crt#' -e 's#/etc/letsencrypt/live/__DOMAIN__/privkey.pem#/etc/nginx/ssl/avina-staging.key#' -e 's/__DOMAIN__/193.242.208.208/g' -e 's/__NAME__/avina-staging/g' /opt/liateam-bot/app/shop/deploy/avina/nginx-avina-staging.conf > /etc/nginx/sites-available/avina-staging
grep -nE 'listen|ssl_certificate|server_name|__' /etc/nginx/sites-available/avina-staging
ln -s /etc/nginx/sites-available/avina-staging /etc/nginx/sites-enabled/avina-staging
nginx -t
systemctl reload nginx
```

**خروجی:**

- `openssl passwd -apr1` دو بار رمز می‌پرسد (رمز Basic Auth کارفرما؛ جدا به او بدهید).
- `grep`: فقط `listen 8444 ssl http2`، `listen [::]:8444 ssl http2`، `server_name 193.242.208.208`، دو مسیر `/etc/nginx/ssl/…` و **هیچ `__`**.
- `nginx -t`: `syntax is ok` و `test is successful`. **اگر خطا داد، `reload` را نزنید**؛ لینک را بردارید (`rm /etc/nginx/sites-enabled/avina-staging`) و دوباره `nginx -t`.
- `curl -sk -o /dev/null -w "%{http_code}\n" https://127.0.0.1:8444/` ← `401` (رمز می‌خواهد)؛ `curl -sk https://127.0.0.1:8444/robots.txt` ← `Disallow: /`.

**فایروال (فقط بررسی، و در صورت نیاز فقط افزودن یک قاعده):**

```bash
ufw status verbose
iptables -S INPUT | head -20
```

- اگر `ufw` فعال (`Status: active`) و ۸۴۴۴ در فهرست نیست: `ufw allow 8444/tcp comment 'avina staging'` (فقط همین قاعده اضافه می‌شود).
- اگر `ufw` غیرفعال است و `iptables` سیاست `DROP` دارد: **بررسی کن** با مجری؛ قاعده‌ی دستی اضافه نکنید.
- **بررسی کن** فایروال پنل ارائه‌دهنده‌ی سرور (اگر دارد) برای پورت ۸۴۴۴.

**بازگشت:** `rm /etc/nginx/sites-enabled/avina-staging && nginx -t && systemctl reload nginx` (و در صورت نیاز `ufw delete allow 8444/tcp`). فایل‌های `sites-available/avina-staging`، `ssl/avina-staging.*` و `avina-staging.htpasswd` مال همین سایت‌اند و می‌شود حذفشان کرد.

---

## ۱۰. راز مشترک revalidate (ربات ← فروشگاه؛ اختیاری)

**هدف:** بعد از هر sync، ربات صفحه‌ها و کش‌های کوتاه فروشگاه را همان لحظه تازه کند. این تنها جایی است که به ربات دست می‌خورد: دو خط به `.env` آن و یک restart کوتاه `liateam-worker` (کدش تغییر نمی‌کند). اگر نمی‌خواهید، این قدم را رد کنید؛ فروشگاه بدون آن هم کار می‌کند.

```bash
openssl rand -hex 32
nano /opt/avina-shop/.env
cp -p /opt/liateam-bot/app/.env /root/backups/liateam-bot.env.before-revalidate
nano /opt/liateam-bot/app/.env
systemctl restart avina-shop liateam-worker
```

- در `/opt/avina-shop/.env`: خط `# REVALIDATE_SECRET=` را به `REVALIDATE_SECRET=<مقدار>` تبدیل کنید.
- در `/opt/liateam-bot/app/.env`: `SHOP_REVALIDATE_URL=http://127.0.0.1:3861/api/internal/revalidate` و `SHOP_REVALIDATE_SECRET=<همان مقدار>`. **بررسی کن** مالک و مجوز فایل بعد از ویرایش عوض نشده باشد (`ls -l /opt/liateam-bot/app/.env`).

**تست یک‌بار:**

```bash
read -rs S; curl -s -X POST -H 'content-type: application/json' -H "x-revalidate-secret: $S" -d '{"paths":[{"path":"/"}]}' http://127.0.0.1:3861/api/internal/revalidate; echo; unset S
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'content-type: application/json' -H 'x-revalidate-secret: wrong' -d '{"paths":[{"path":"/"}]}' http://127.0.0.1:3861/api/internal/revalidate
```

**خروجی:** `{"ok":true,"revalidated":["/"]}` و با راز اشتباه `401`. بعد از اجرای بعدی ربات، `journalctl -u avina-shop --since "-30min" --no-pager | grep revalidate.done` یک خط نشان می‌دهد.
**بازگشت:** `cp -p /root/backups/liateam-bot.env.before-revalidate /opt/liateam-bot/app/.env && systemctl restart liateam-worker`، و در فروشگاه خط را دوباره کامنت و `systemctl restart avina-shop`.

---

## ۱۱. چک نهایی

در مرورگر `https://193.242.208.208:8444` را باز کنید؛ هشدار گواهی (خودامضا) را با «Advanced ← Proceed» رد کنید؛ نام کاربری `client` و رمز Basic Auth.

| چک                   | انتظار                                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| صفحه‌ی اصلی          | اسلایدر، دسته‌ها، تخفیفات ویژه، برندها، پرفروش‌ترین‌ها، روتین پوستی، مجله، بنر همکاری                                                                                                                                |
| یک محصول             | قالب ثابت، قیمت تومان، تب‌ها، ویدیو با دکمه‌ی پخش                                                                                                                                                                    |
| `/offers`، `/brands` | محصولات تخفیف‌دار / فهرست برندها                                                                                                                                                                                     |
| منو                  | مگامنو دسته‌ها و برندها (دسکتاپ)، کشوی ☰ (موبایل)                                                                                                                                                                   |
| ورود OTP             | شماره ← کد از لاگ: `journalctl -u avina-shop --since "-10min" --no-pager \| grep sms.dev.otp`                                                                                                                        |
| پنل مدیریت           | `runuser -u avina -- env HOME=/opt/avina-shop/.cache bash -c 'cd /opt/avina-shop && set -a && . ./.env && set +a && npm run grant-role -- 09xxxxxxxxx admin'` سپس `/admin`                                           |
| نبودن قیمت خرید      | `curl -sk -u client https://127.0.0.1:8444/ \| grep -cE 'cost_price\|payable_price\|discount_price'` ← `0` (رمز را می‌پرسد)                                                                                          |
| سلامت                | `curl -s http://127.0.0.1:3861/health` ← `"status":"ok"`                                                                                                                                                             |
| قیمت‌ها و جست‌وجو    | `runuser -u avina -- env HOME=/opt/avina-shop/.cache bash -c 'cd /opt/avina-shop && set -a && . ./.env && set +a && npm run check:prices -- http://127.0.0.1:3861 && npm run check:search -- http://127.0.0.1:3861'` |
| لاگ                  | `journalctl -u avina-shop --since "-30min" -p warning --no-pager` بدون خطای تکراری                                                                                                                                   |
| منابع                | `systemctl status avina-shop --no-pager \| grep -E 'Memory\|CPU'` زیر ۷۶۸M                                                                                                                                           |

**سرعت از لپ‌تاپ:** اسکریپت `perf` فعلاً گزینه‌ای برای رد کردن هشدار گواهی خودامضا و Basic Auth ندارد، پس مستقیم روی `https://193.242.208.208:8444` اجرا نمی‌شود. راه دور زدن: تونل SSH به خود فروشگاه (بدون nginx؛ فشرده‌سازی را خود Next انجام می‌دهد):

```bash
ssh -p 9011 -N -L 3861:127.0.0.1:3861 root@193.242.208.208
```

در پنجره‌ی دیگر روی لپ‌تاپ (در `shop/` مخزن، با `npm ci` و Chromium مربوط به Playwright در ریشه):

```bash
npm run perf -- http://127.0.0.1:3861 --pages /,/shop,/brands,/offers --runs 3
```

برای صفحه‌ی محصول آدرس کامل را بدهید (مثلاً `--pages /<slug>`؛ `pN` فقط با `DATABASE_URL` همان دیتابیس کار می‌کند). عددها شامل تأخیر تونل SSH هم هستند.

**حداقل چک‌های رانبوک بعد از هر دیپلوی:** `/health`، `check:prices`، `check:search`، لاگ هشدارها، `systemctl start avina-shop-images-warm`، و هر چند هفته `npm audit --omit=dev` در `/opt/avina-shop`.

---

## ۱۲. تبدیل به دامنه (فعلاً فقط توضیح)

۱. **رکورد A:** دامنه یا زیردامنه‌ی staging ← `193.242.208.208` (و AAAA اگر IPv6 دارد).
۲. **قالب کامل:** `nginx-avina-staging.conf` با `__DOMAIN__` = دامنه و `__NAME__` = `avina-staging`، طبق `shop/README.md` بخش «نصب روی سرور اشتراکی»: اول فقط بخش پورت ۸۰ (پوشه‌ی `/var/www/avina-staging-acme`)، `nginx -t`، سپس reload.
۳. **گواهی:** `certbot certonly --webroot -w /var/www/avina-staging-acme -d <دامنه>` (certbot هیچ فایل nginx را ویرایش نمی‌کند؛ تمدید با تایمر خود certbot).
۴. **server block کامل** (۴۴۳ با گواهی Let's Encrypt) در همان فایل جدید، `nginx -t`، سپس reload. **بررسی کن:** سایت‌های دیگر روی ۴۴۳ هستند و `server_name` جدا کافی است؛ پیش از reload خروجی `nginx -t` را ببینید.
۵. **حذف حالت IP:** `rm /etc/nginx/sites-enabled/avina-staging` (فایل ۸۴۴۴)، `nginx -t`، reload، و در صورت باز کردن پورت: `ufw delete allow 8444/tcp`.
۶. **فروشگاه و ربات:** نیازی به تغییر env نیست (فروشگاه همچنان روی `127.0.0.1:3861`). در production نهایی، `APP_ENV=production` و نقش‌ها و اسکیمای `shop` با رانبوک اصلی.
