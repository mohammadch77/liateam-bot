'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { formatToman } from '@/lib/format/money';
import { formatNumber, toFaDigits } from '@/lib/format/number';
import { defaultMethod, payBlocker, type PayMethodId, type PayOptions } from '@/lib/orders/payment-flow';
import { cartPath } from '@/lib/urls';
import { PayMethods } from '../_pay/PayMethods';
import { Alert, Button, Icon, Select, Spinner, TextField } from '@/ui';
import type { CheckoutView } from '@/server/services/checkout.service';
import {
  addAddressAction,
  applyReviewAction,
  citiesAction,
  enterReferralAction,
  payAction,
  provincesAction,
  reviewStatusAction,
  startReviewAction,
  type AddressView,
} from './actions';
import s from './checkout.module.css';

type Geo = Array<{ id: number; name: string }>;
type Ready = Extract<CheckoutView, { state: 'ready' }>;

/** Phase of the live check: none yet, waiting for the bot, answered, or failed / timed out. */
type Review =
  | { phase: 'idle' }
  | { phase: 'pending'; jobId: number }
  | { phase: 'ready'; view: Ready }
  | { phase: 'failed'; message: string };

const POLL_MS = 1000;
const POLL_LIMIT = 15; // seconds the bot gets to answer

const addressLine = (a: AddressView) =>
  `${a.province}، ${a.city}، ${a.line}${a.plate ? `، پلاک ${a.plate}` : ''}${a.unit ? `، واحد ${a.unit}` : ''}`;

/** mm:ss in Persian digits */
const clock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return toFaDigits(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
};

/**
 * The checkout in one page: 1) the address, 2) the live check of prices and stock against Liateam (asked of the sync bot,
 * answered in seconds; 15 minutes of hold, then it must be asked again), 3) the totals and «ثبت سفارش». The page never
 * computes money: the server does, from the cart and the check.
 */
export function CheckoutFlow({
  addresses: initial,
  defaultPhone,
  defaultName,
  pay,
  cart,
  referral,
}: {
  addresses: AddressView[];
  defaultPhone: string;
  defaultName: string;
  /** what the customer can pay with (from the server) */
  pay: PayOptions;
  /** the cart's own numbers (before the live check): shown in the summary from the start */
  cart: { units: number; itemsTotal: number; discountTotal: number };
  /** the referral code: may one still be typed, and the one the account has (locked) */
  referral: { canEnter: boolean; code: string | null };
}) {
  const [addresses, setAddresses] = useState(initial);
  const [addressId, setAddressId] = useState<string | null>(
    initial.find((a) => a.is_default)?.id ?? initial[0]?.id ?? null,
  );
  const [adding, setAdding] = useState(initial.length === 0);
  const [review, setReview] = useState<Review>({ phase: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [placing, startPlacing] = useTransition();
  const [chosen, setChosen] = useState<{ job: number; method: PayMethodId } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const gen = useRef({ n: 0 }); // a newer check cancels the polling of an older one
  const reviewRef = useRef<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);

  // the step after the address: the page moves there gently (not for the address that was chosen from the start)
  const toReview = useCallback(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' }), 60);
  }, []);

  const check = useCallback(async (forAddress: string, notice: string | null = null) => {
    const g = gen.current;
    const mine = ++g.n;
    setError(notice);
    setReview({ phase: 'idle' });
    const started = await startReviewAction(forAddress);
    if (mine !== g.n) return;
    if (!started.ok) return setReview({ phase: 'failed', message: started.error });
    const jobId = started.data.jobId;
    setReview({ phase: 'pending', jobId });
    for (let i = 0; i < POLL_LIMIT; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (mine !== g.n) return;
      const r = await reviewStatusAction(jobId, forAddress);
      if (mine !== g.n) return;
      if (!r.ok) return setReview({ phase: 'failed', message: r.error });
      if (r.data.state === 'ready') return setReview({ phase: 'ready', view: r.data });
      if (r.data.state === 'failed') return setReview({ phase: 'failed', message: r.data.message });
    }
    setReview({ phase: 'failed', message: 'اتصال به سامانه‌ی تأمین‌کننده برقرار نشد. دوباره تلاش کنید.' });
  }, []);

  // a check starts by itself when an address is chosen
  useEffect(() => {
    if (!addressId) return;
    const g = gen.current;
    const t = setTimeout(() => void check(addressId), 0);
    return () => {
      clearTimeout(t);
      g.n += 1;
    };
  }, [addressId, check]);

  // the hold's countdown
  useEffect(() => {
    if (review.phase !== 'ready') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [review]);

  const ready = review.phase === 'ready' ? review.view : null;
  const total = ready?.totals?.totalPayable ?? null;
  const left = ready ? Date.parse(ready.expiresAt) - now : 0;
  const expired = ready ? ready.expired || left <= 0 : false;
  // the method: the customer's choice for THIS answer, else the one that fits it (the only usable one when there is one)
  const method: PayMethodId = chosen && chosen.job === ready?.jobId ? chosen.method : defaultMethod(pay, total);
  const blocker = payBlocker({
    hasAddress: !!addressId,
    phase: review.phase,
    canOrder: !!ready?.canOrder,
    expired,
    reason: ready?.reason ?? null,
    pay,
    total,
    method,
  });
  const stepAt = !addressId ? 1 : review.phase === 'ready' && ready?.canOrder && !expired ? 3 : 2;
  const toSummary = () => summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const fixAndRecheck = async () => {
    if (!ready || !addressId) return;
    const r = await applyReviewAction(ready.jobId);
    if (!r.ok) return setError(r.error);
    // the cart changed: the page's numbers are reloaded with the new check
    void check(addressId);
  };

  const place = () =>
    startPlacing(async () => {
      if (!ready || !addressId) return;
      setError(null);
      const r = await payAction(addressId, ready.jobId, method); // redirects on success
      if (r && !r.ok) {
        void check(addressId, r.error);
      }
    });

  return (
    <>
    <ol className={s.progress} aria-label="مراحل تسویه" data-checkout-steps>
      {['آدرس', 'بررسی قیمت و موجودی', 'پرداخت'].map((label, i) => (
        <li
          key={label}
          data-step={i + 1}
          data-state={i + 1 < stepAt ? 'done' : i + 1 === stepAt ? 'current' : 'todo'}
          aria-current={i + 1 === stepAt ? 'step' : undefined}
        >
          <span className={s.progressNum}>{i + 1 < stepAt ? <Icon name="check" size={16} /> : toFaDigits(i + 1)}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
    <div className={s.layout}>
      <div className={s.steps}>
        <section className={s.card} aria-labelledby="co-address">
          <h2 id="co-address" className={s.h2}>
            <span className={s.num}>۱</span> آدرس تحویل
          </h2>
          {addresses.length > 0 && (
            <ul className={s.addresses} role="radiogroup" aria-labelledby="co-address">
              {addresses.map((a) => (
                <li key={a.id}>
                  <label className={s.address} data-selected={a.id === addressId}>
                    <input
                      type="radio"
                      name="address"
                      value={a.id}
                      checked={a.id === addressId}
                      onChange={() => {
                        setAddressId(a.id);
                        toReview();
                      }}
                    />
                    <span>
                      <b>{a.recipient_name}</b> ·{' '}
                      <span className="tnum">{toFaDigits(a.recipient_phone)}</span>
                      <span className={s.addrLine}>{addressLine(a)}</span>
                      {a.city_id === null && (
                        <span className={s.warn}>این آدرس شناسه‌ی شهر لیاتیم ندارد؛ آدرس جدید ثبت کنید.</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {adding ? (
            <AddressForm
              defaultPhone={defaultPhone}
              defaultName={defaultName}
              onCancel={addresses.length ? () => setAdding(false) : undefined}
              onSaved={(a) => {
                setAddresses((l) => [a, ...l]);
                setAddressId(a.id);
                setAdding(false);
                toReview();
              }}
            />
          ) : (
            <Button variant="outline" icon="add" onClick={() => setAdding(true)} data-add-address>
              افزودن آدرس جدید
            </Button>
          )}
        </section>

        {(referral.canEnter || referral.code) && <ReferralBox state={referral} />}

        <section
          className={s.card}
          aria-labelledby="co-review"
          aria-busy={review.phase === 'pending'}
          ref={reviewRef}
          data-step-review
        >
          <h2 id="co-review" className={s.h2}>
            <span className={s.num}>۲</span> بررسی قیمت و موجودی
          </h2>

          {!addressId && <p className={s.muted}>ابتدا آدرس تحویل را انتخاب کنید.</p>}

          {review.phase === 'pending' && (
            <p className={s.pending} role="status" data-review="pending">
              <Spinner /> در حال بررسی قیمت و موجودی از تأمین‌کننده…
            </p>
          )}

          {review.phase === 'failed' && (
            <div data-review="failed">
              <Alert tone="danger">{review.message}</Alert>
              {addressId && (
                <Button
                  variant="outline"
                  icon="refresh"
                  onClick={() => void check(addressId)}
                  data-review-retry
                >
                  تلاش مجدد
                </Button>
              )}
            </div>
          )}

          {ready && (
            <div data-review="ready">
              {ready.reason && <Alert tone="danger">{ready.reason}</Alert>}
              {ready.anyPriceChanged && (
                <Alert tone="warning">
                  قیمت بعضی کالاها از زمانی که به سبد افزودید تغییر کرده و به‌روز شد.
                </Alert>
              )}
              {ready.cartChanged && (
                <Alert tone="warning">سبد بعد از بررسی تغییر کرده است. دوباره بررسی کنید.</Alert>
              )}
              <ul className={s.lines}>
                {ready.lines.map((l) => (
                  <li
                    key={l.productId}
                    className={s.line}
                    data-line-status={l.status}
                    data-line={l.productId}
                  >
                    <span className={s.thumb} aria-hidden="true">
                      {l.imageUrl && <Image src={l.imageUrl} alt="" fill sizes="64px" draggable={false} />}
                    </span>
                    <span className={s.lineInfo}>
                      <Link href={l.href} className={s.lineName}>
                        {l.name}
                      </Link>
                      {l.status === 'ok' && (
                        <span className={s.ok}>
                          {formatNumber(l.quantity)} عدد ·{' '}
                          <span className="tnum">{formatToman(l.lineTotal)}</span> تومان
                          {l.limited && <span className={s.limited}> · موجودی محدود</span>}
                          {l.priceChanged && <span className={s.limited}> · قیمت به‌روز شد</span>}
                        </span>
                      )}
                      {l.status === 'adjusted' && (
                        <span className={s.warn}>
                          فقط {formatNumber(l.available)} عدد موجود است (درخواست شما:{' '}
                          {formatNumber(l.quantity)}).
                        </span>
                      )}
                      {(l.status === 'unavailable' || l.status === 'missing') && (
                        <span className={s.bad}>ناموجود شد.</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {(ready.hasUnavailable || ready.hasAdjusted || ready.cartChanged) && !expired && (
                <Button icon="refresh" onClick={() => void fixAndRecheck()} data-review-fix>
                  {ready.hasUnavailable || ready.hasAdjusted
                    ? 'اعمال تغییرات و بررسی دوباره'
                    : 'بررسی دوباره'}
                </Button>
              )}
              {expired ? (
                <div data-review="expired">
                  <Alert tone="warning">
                    مهلت نگه‌داری موجودی تمام شد. دوباره بررسی کنید تا قیمت و موجودی تازه شود.
                  </Alert>
                  {addressId && (
                    <Button icon="refresh" onClick={() => void check(addressId)} data-review-retry>
                      بررسی دوباره
                    </Button>
                  )}
                </div>
              ) : (
                <p className={s.timer} role="timer" aria-live="off" data-review-timer>
                  <Icon name="lock" size={16} /> موجودی تا <b className="tnum">{clock(left)}</b> دیگر برای شما
                  نگه داشته می‌شود.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      <aside className={s.summary} aria-label="خلاصه‌ی سفارش" data-checkout-summary ref={summaryRef}>
        <h2 className={s.h2}>خلاصه‌ی سفارش</h2>
        {ready?.totals && !expired ? (
          <>
            <dl className={s.rows}>
              <div>
                <dt>جمع کالاها</dt>
                <dd className="tnum">{formatToman(ready.totals.itemsTotal)} تومان</dd>
              </div>
              {ready.totals.discountTotal > 0 && (
                <div className={s.off}>
                  <dt>تخفیف شما</dt>
                  <dd className="tnum">{formatToman(ready.totals.discountTotal)} تومان</dd>
                </div>
              )}
              <div>
                <dt>ارسال ({ready.shippingTitle ?? 'پست'})</dt>
                <dd className="tnum" data-shipping-charged={ready.totals.shippingCharged}>
                  {ready.totals.shippingFree
                    ? 'رایگان'
                    : `${formatToman(ready.totals.shippingCharged)} تومان`}
                </dd>
              </div>
              <div className={s.total}>
                <dt>مبلغ قابل پرداخت</dt>
                <dd className="tnum" data-payable={ready.totals.totalPayable}>
                  {formatToman(ready.totals.totalPayable)} تومان
                </dd>
              </div>
            </dl>
            <p className={s.delivery} data-delivery>
              <Icon name="local_shipping" size={18} />
              {ready.delivery
                ? ` زمان تحویل: حدود ${toFaDigits(ready.delivery.minDays)}${ready.delivery.maxDays !== ready.delivery.minDays ? ` تا ${toFaDigits(ready.delivery.maxDays)}` : ''} روز پس از ثبت سفارش`
                : ' زمان تحویل پس از ثبت سفارش اعلام می‌شود.'}
            </p>
          </>
        ) : (
          <>
            <dl className={s.rows} data-summary-provisional>
              <div>
                <dt>جمع کالاها ({toFaDigits(cart.units)} عدد)</dt>
                <dd className="tnum">{formatToman(cart.itemsTotal)} تومان</dd>
              </div>
              {cart.discountTotal > 0 && (
                <div className={s.off}>
                  <dt>تخفیف شما</dt>
                  <dd className="tnum">{formatToman(cart.discountTotal)} تومان</dd>
                </div>
              )}
              <div>
                <dt>ارسال</dt>
                <dd>{addressId ? 'پس از بررسی' : 'پس از انتخاب آدرس'}</dd>
              </div>
            </dl>
            <p className={s.muted}>
              {addressId
                ? 'هزینه‌ی ارسال و مبلغ نهایی بعد از بررسی قیمت و موجودی نمایش داده می‌شود.'
                : 'با انتخاب آدرس، هزینه‌ی ارسال و مبلغ نهایی محاسبه می‌شود.'}
            </p>
          </>
        )}
        {ready?.canOrder && (
          <PayMethods key={`${ready.jobId}`} options={pay} total={total} onChange={(m) => setChosen({ job: ready.jobId, method: m })} />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Button
          size="lg"
          block
          disabled={blocker !== null}
          loading={placing}
          loadingText="در حال انتقال به پرداخت…"
          onClick={place}
          data-place-order
        >
          پرداخت
        </Button>
        {blocker && (
          <p className={s.blocker} role="status" data-pay-blocked>
            <Icon name="error" size={16} /> {blocker}
          </p>
        )}
        <p className={s.note}>تا زمانی که پرداخت را تأیید نکنید، مبلغی از شما کم نمی‌شود.</p>
        <Link href={cartPath()} className={s.back}>
          بازگشت به سبد خرید
        </Link>
      </aside>
    </div>
    <div className={s.bar} data-checkout-bar>
      <span className={s.barTotal}>
        <small>{total !== null ? 'مبلغ قابل پرداخت' : 'جمع کالاها'}</small>
        <b className="tnum">{formatToman(total ?? cart.itemsTotal)} تومان</b>
      </span>
      <Button size="lg" variant={blocker ? 'outline' : 'primary'} onClick={toSummary} data-bar-go>
        {blocker ? 'خلاصه‌ی سفارش' : 'ادامه و پرداخت'}
      </Button>
    </div>
    </>
  );
}

function AddressForm({
  defaultPhone,
  defaultName,
  onSaved,
  onCancel,
}: {
  defaultPhone: string;
  defaultName: string;
  onSaved: (a: AddressView) => void;
  onCancel?: (() => void) | undefined;
}) {
  const [provinces, setProvinces] = useState<Geo>([]);
  const [cities, setCities] = useState<Geo>([]);
  const [provinceId, setProvinceId] = useState('');
  const [cityId, setCityId] = useState('');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [loadingGeo, setLoadingGeo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    provincesAction().then((r) => {
      if (!live) return;
      if (r.ok) setProvinces(r.data);
      else setGeoError(r.error);
      setLoadingGeo(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const pickProvince = async (value: string) => {
    setProvinceId(value);
    setCityId('');
    setCities([]);
    if (!value) return;
    setLoadingGeo(true);
    const r = await citiesAction(Number(value));
    setLoadingGeo(false);
    if (r.ok) setCities(r.data);
    else setGeoError(r.error);
  };

  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const r = await addAddressAction({
        provinceId: Number(provinceId),
        cityId: Number(cityId),
        line: String(form.get('line') ?? ''),
        plate: String(form.get('plate') ?? ''),
        unit: String(form.get('unit') ?? ''),
        recipientName: String(form.get('name') ?? ''),
        recipientPhone: String(form.get('phone') ?? ''),
        postalCode: String(form.get('postal') ?? ''),
      });
      if (r.ok) onSaved(r.data);
      else setError(r.error);
    });

  return (
    <form action={submit} className={s.form} data-address-form>
      {geoError && <Alert tone="danger">{geoError}</Alert>}
      <div className={s.grid}>
        <TextField
          label="نام و نام خانوادگی گیرنده"
          name="name"
          defaultValue={defaultName}
          autoComplete="name"
          required
        />
        <TextField
          label="موبایل گیرنده"
          name="phone"
          defaultValue={defaultPhone}
          inputMode="tel"
          autoComplete="tel"
          ltr
          required
        />
        <Select
          label="استان"
          name="province"
          value={provinceId}
          onChange={(e) => void pickProvince(e.target.value)}
          options={[
            { value: '', label: loadingGeo && !provinces.length ? 'در حال بارگذاری…' : 'انتخاب استان' },
            ...provinces.map((p) => ({ value: String(p.id), label: p.name })),
          ]}
          required
        />
        <Select
          label="شهر"
          name="city"
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          disabled={!provinceId}
          options={[
            { value: '', label: 'انتخاب شهر' },
            ...cities.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
          required
        />
        <TextField
          label="کد پستی"
          name="postal"
          inputMode="numeric"
          ltr
          autoComplete="postal-code"
          placeholder="۱۰ رقم"
          required
        />
        <TextField label="پلاک" name="plate" inputMode="numeric" required />
        <TextField label="واحد" labelNote="اختیاری" name="unit" inputMode="numeric" />
        <TextField label="نشانی کامل" name="line" autoComplete="street-address" required />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className={s.formActions}>
        <Button type="submit" icon="check" loading={pending} loadingText="در حال ذخیره…" disabled={!cityId}>
          ذخیره و ادامه
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            انصراف
          </Button>
        )}
      </div>
    </form>
  );
}

/** «کد معرف (اختیاری)»: a field before the first paid order; once a code is recorded it is shown locked. */
function ReferralBox({ state }: { state: { canEnter: boolean; code: string | null } }) {
  const [code, setCode] = useState(state.code);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const r = await enterReferralAction(String(form.get('ref') ?? ''));
      if (r.ok) setCode(r.data.code);
      else setError(r.error);
    });
  return (
    <section className={s.card} aria-labelledby="co-ref" data-referral-box>
      <h2 id="co-ref" className={s.h2}>
        کد معرف <span className={s.muted}>(اختیاری)</span>
      </h2>
      {code ? (
        <p data-referral-locked>
          کد معرف شما: <b dir="ltr">{code}</b> — ثبت شد و قابل تغییر نیست.
        </p>
      ) : (
        <form action={submit} className={s.form}>
          <TextField
            name="ref"
            label="کد معرف"
            ltr
            autoCapitalize="none"
            autoComplete="off"
            maxLength={20}
            hint="فقط تا قبل از اولین خرید پرداخت‌شده؛ بعد از ثبت قابل تغییر نیست."
            error={error ?? undefined}
          />
          <Button type="submit" variant="outline" loading={pending} loadingText="در حال بررسی…">
            ثبت کد معرف
          </Button>
        </form>
      )}
    </section>
  );
}
