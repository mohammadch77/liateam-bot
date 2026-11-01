import { z } from 'zod';

/**
 * The registry of every setting the admin can change: one typed place for the key, the group it is shown in, its Persian
 * label, its type, how a value is validated, its default, and who may see it. Nothing else in the shop invents a key.
 *
 *   exposure  public    safe to send to a browser (none yet: the storefront reads settings on the server)
 *             internal  only the server and the admin panel
 *             secret    never leaves the server: encrypted in secret_settings, shown masked, written only
 *
 * Plain values live in site_settings (key → JSON), secrets in secret_settings (AES-256-GCM). parseStored() turns whatever
 * is stored into a valid value or the default; it never throws, so a bad row cannot take a page down.
 */
export type SettingGroup = 'general' | 'orders' | 'shipping' | 'commission' | 'sms' | 'payment';
export type Exposure = 'public' | 'internal' | 'secret';
export type SettingKind = 'boolean' | 'integer' | 'text' | 'url' | 'enum' | 'timerange' | 'secret';

export type SettingDef<T = unknown> = {
  key: string;
  group: SettingGroup;
  label: string;
  hint?: string;
  kind: SettingKind;
  exposure: Exposure;
  schema: z.ZodType<T>;
  default: T;
  unit?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** reserved for the payment / SMS / commission work (S2): stored and audited, not used by the order flow yet */
  placeholder?: boolean;
};

export type TimeRange = { from: string; to: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

/** «۱٬۲۳۴» / «1,234» / «۱۲۳۴» → '1234' (what an admin may type into a number field) */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC.indexOf(d)))
    .replace(/[٬,،\s]/g, '');
}

const integer = (min: number, max: number, message: string) =>
  z.number({ error: message }).int(message).min(min, message).max(max, message);

/** An https origin (http only for localhost): https://shop.example.com — no path, query or credentials; '' = not set. */
const originSchema = z
  .string()
  .trim()
  .max(200)
  .refine((v) => {
    if (v === '') return true;
    try {
      const u = new URL(v);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      return (
        (u.protocol === 'https:' || (u.protocol === 'http:' && local)) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.pathname === '/'
      );
    } catch {
      return false;
    }
  }, 'آدرس باید با https:// شروع شود و فقط دامنه باشد (بدون مسیر)، مثل https://shop.example.com')
  .transform((v) => v.replace(/\/$/, ''));

const secretSchema = z
  .string()
  .trim()
  .min(8, 'مقدار خیلی کوتاه است.')
  .max(300, 'مقدار خیلی بلند است.')
  .refine((v) => !/[\s\u0000-\u001f]/.test(v), 'مقدار نباید فاصله یا خط جدید داشته باشد.');

const make = <T>(d: Omit<SettingDef<T>, 'exposure'> & { exposure?: Exposure }): SettingDef<T> => ({
  exposure: 'internal',
  ...d,
});

export const SETTINGS = {
  'site.base_url': make({
    key: 'site.base_url',
    group: 'general',
    label: 'آدرس پایه‌ی سایت',
    hint: 'برای آدرس بازگشت درگاه پرداخت و پیامک‌ها (مثلاً https://shop.example.com). خالی = تنظیم نشده.',
    kind: 'url',
    schema: originSchema,
    default: '',
  }),
  'pricing.discount_mode': make({
    key: 'pricing.discount_mode',
    group: 'general',
    label: 'روش اعمال تخفیف لیاتیم',
    kind: 'enum',
    // the first version stored 'liateam' / 'excess'
    schema: z.preprocess(
      (v) => (v === 'liateam' ? 'consumer' : v === 'excess' ? 'beyond_base' : v),
      z.enum(['partner', 'consumer', 'beyond_base']),
    ) as z.ZodType<'partner' | 'consumer' | 'beyond_base'>,
    default: 'partner' as 'partner' | 'consumer' | 'beyond_base',
    options: [
      { value: 'partner', label: 'تخفیف همکاری به مشتری (پیش‌فرض)' },
      { value: 'consumer', label: 'فقط تخفیف خط‌خوردنی لیاتیم' },
      { value: 'beyond_base', label: 'فقط مازاد بر سود پایه' },
    ],
  }),
  'security.admin_session_hours': make({
    key: 'security.admin_session_hours',
    group: 'general',
    label: 'مدت اعتبار نشست مدیر',
    hint: 'بعد از این مدت (از لحظه‌ی ورود) پنل مدیریت دوباره کد ورود می‌خواهد؛ نشست مشتری‌ها همان ۳۰ روز می‌ماند.',
    kind: 'integer',
    unit: 'ساعت',
    schema: integer(1, 72, 'عدد بین ۱ و ۷۲ وارد کنید.'),
    default: 8,
  }),
  'seo.block_indexing': make({
    key: 'seo.block_indexing',
    group: 'general',
    label: 'جلوگیری از ایندکس شدن توسط موتورهای جستجو',
    hint: 'روی نسخه‌ی آزمایشی (staging) همیشه روشن است؛ این گزینه فقط روی سایت اصلی اثر دارد.',
    kind: 'boolean',
    schema: z.boolean(),
    default: true,
  }),

  'orders.auto_place_enabled': make({
    key: 'orders.auto_place_enabled',
    group: 'orders',
    label: 'ثبت خودکار سفارش در لیاتیم',
    hint: 'خاموش: سفارش‌های پرداخت‌شده در صف می‌مانند تا اپراتور خودش ثبت کند.',
    kind: 'boolean',
    schema: z.boolean(),
    default: false,
  }),
  'orders.auto_place_hours': make({
    key: 'orders.auto_place_hours',
    group: 'orders',
    label: 'ساعات کاری ثبت خودکار (به وقت تهران)',
    hint: 'خارج از این بازه سفارش منتظر می‌ماند و صبح دوباره بررسی می‌شود. اگر «از» بعد از «تا» باشد بازه از نیمه‌شب می‌گذرد؛ دو ساعت برابر یعنی ۲۴ ساعته.',
    kind: 'timerange',
    schema: z.object({
      from: z.string().regex(HHMM, 'ساعت شروع نامعتبر است (مثل ۰۹:۰۰).'),
      to: z.string().regex(HHMM, 'ساعت پایان نامعتبر است (مثل ۲۱:۰۰).'),
    }),
    default: { from: '09:00', to: '21:00' } as TimeRange,
  }),
  'orders.price_tolerance_toman': make({
    key: 'orders.price_tolerance_toman',
    group: 'orders',
    label: 'آستانه‌ی اختلاف قیمت',
    hint: 'اگر جمع زنده‌ی لیاتیم بیشتر از این مقدار با جمع سفارش فرق کند، سفارش برای بررسی نگه داشته می‌شود.',
    kind: 'integer',
    unit: 'تومان',
    schema: integer(0, 10_000_000, 'عدد بین ۰ و ۱۰٬۰۰۰٬۰۰۰ تومان وارد کنید.'),
    default: 10,
  }),

  'shipping.free_enabled': make({
    key: 'shipping.free_enabled',
    group: 'shipping',
    label: 'ارسال رایگان',
    hint: 'روشن: از آستانه‌ی زیر به بالا، مشتری هزینه‌ی ارسال نمی‌دهد و فروشگاه هزینه‌ی لیاتیم را می‌پذیرد.',
    kind: 'boolean',
    schema: z.boolean(),
    default: false,
  }),
  'shipping.free_from_toman': make({
    key: 'shipping.free_from_toman',
    group: 'shipping',
    label: 'ارسال رایگان از جمع کالا',
    hint: 'جمع کالاها بعد از تخفیف.',
    kind: 'integer',
    unit: 'تومان',
    schema: integer(1, 10_000_000_000, 'مبلغ معتبر (حداقل ۱ تومان) وارد کنید.'),
    default: 999_000,
  }),
  'shipping.extra_days': make({
    key: 'shipping.extra_days',
    group: 'shipping',
    label: 'روزهای اضافه‌ی تحویل',
    hint: 'به بازه‌ی روز کاری هر استان اضافه می‌شود و در تسویه نشان داده می‌شود.',
    kind: 'integer',
    unit: 'روز',
    schema: integer(0, 30, 'عدد بین ۰ و ۳۰ وارد کنید.'),
    default: 1,
  }),

  'commission.default_percent': make({
    key: 'commission.default_percent',
    group: 'commission',
    label: 'درصد پیش‌فرض پورسانت همکاران فروش',
    kind: 'integer',
    unit: 'درصد',
    schema: integer(0, 50, 'عدد بین ۰ و ۵۰ وارد کنید.'),
    default: 0,
    placeholder: true,
  }),
  'sms.api_key': make({
    key: 'sms.api_key',
    group: 'sms',
    label: 'کلید API سرویس پیامک',
    kind: 'secret',
    exposure: 'secret',
    schema: secretSchema,
    default: '',
    placeholder: true,
  }),
  'payment.merchant_id': make({
    key: 'payment.merchant_id',
    group: 'payment',
    label: 'شناسه‌ی پذیرنده‌ی درگاه پرداخت',
    kind: 'secret',
    exposure: 'secret',
    schema: secretSchema,
    default: '',
    placeholder: true,
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const PLAIN_KEYS = SETTING_KEYS.filter((k) => SETTINGS[k].kind !== 'secret');
export const SECRET_KEYS = SETTING_KEYS.filter((k) => SETTINGS[k].kind === 'secret');

export const GROUPS: ReadonlyArray<{ id: SettingGroup; label: string; placeholder?: boolean }> = [
  { id: 'general', label: 'عمومی' },
  { id: 'orders', label: 'سفارش و ثبت خودکار' },
  { id: 'shipping', label: 'ارسال' },
  { id: 'commission', label: 'پورسانت', placeholder: true },
  { id: 'sms', label: 'پیامک', placeholder: true },
  { id: 'payment', label: 'پرداخت', placeholder: true },
];

export const isSettingKey = (k: string): k is SettingKey => Object.hasOwn(SETTINGS, k);
export const isSecretKey = (k: string): boolean => isSettingKey(k) && SETTINGS[k].kind === 'secret';
export const keysOf = (group: SettingGroup): SettingKey[] =>
  SETTING_KEYS.filter((k) => SETTINGS[k].group === group);

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates a value (already typed); the error is a Persian message for the admin. */
export function validateSetting(key: SettingKey, input: unknown): Checked<unknown> {
  const r = SETTINGS[key].schema.safeParse(input);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, error: `${SETTINGS[key].label}: ${r.error.issues[0]?.message ?? 'مقدار نامعتبر است.'}` };
}

/** What is stored → a valid value, or the default. Never throws. */
export function parseStored(key: SettingKey, raw: unknown): unknown {
  if (raw === undefined || raw === null) return SETTINGS[key].default;
  const r = SETTINGS[key].schema.safeParse(raw);
  return r.success ? r.data : SETTINGS[key].default;
}

/**
 * One field of the admin form (strings from FormData) → the typed value for validateSetting().
 * An absent checkbox is false; numbers accept Persian digits and separators; an unreadable number stays NaN (rejected).
 */
export function fromFormField(
  key: SettingKey,
  form: { get(name: string): unknown; has(name: string): boolean },
): unknown {
  const def = SETTINGS[key];
  const text = (name: string) => (typeof form.get(name) === 'string' ? (form.get(name) as string) : '');
  switch (def.kind) {
    case 'boolean':
      return text(key) === '1';
    case 'integer': {
      const t = toLatinDigits(text(key));
      return /^\d+$/.test(t) ? Number(t) : Number.NaN;
    }
    case 'timerange':
      return {
        from: toLatinDigits(text(`${key}.from`)).replace(/^(\d):/, '0$1:'),
        to: toLatinDigits(text(`${key}.to`)).replace(/^(\d):/, '0$1:'),
      };
    default:
      return text(key);
  }
}

/** ••••1234 — the only form in which a secret is ever shown (hint = its last 4 characters, kept apart when it was stored) */
export const maskSecret = (hint: string | null): string => `••••${hint ?? ''}`;

/** The hint to keep for a secret: its last 4 characters, but only when it is long enough that they reveal little. */
export const secretHint = (value: string): string => (value.length >= 12 ? value.slice(-4) : '');
