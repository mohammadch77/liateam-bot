import Link from 'next/link';
import type { CommissionResult, CommissionRule } from '@/lib/commission/engine';
import { MAX_LEVEL } from '@/lib/commission/validate';
import { formatNumber } from '@/lib/format/number';
import { adminSettingsPath } from '@/lib/urls';
import type { SimulatorInput } from '@/server/services/commission.service';
import { Alert, Button } from '@/ui';
import a from '../admin-forms.module.css';
import { saveRuleAction } from './actions';
import t from './settings.module.css';

const SCOPE_LABEL = { all: 'همه‌ی کالاها', category: 'دسته', brand: 'برند', product: 'محصول' } as const;
const REASON: Record<string, string> = {
  no_rule: 'قاعده‌ی قابل‌اعمالی برای این سطح نیست',
  no_matching_line: 'هیچ‌یک از کالاها در محدوده‌ی قاعده‌ها نیست',
  zero_amount: 'مبلغ محاسبه‌شده صفر است',
};
const STATUS: Record<string, string> = { pending: 'در انتظار', approved: 'قابل تأیید', cancelled: 'لغو' };
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');

function RuleForm({ rule }: { rule: CommissionRule | null }) {
  const scope = rule?.scope ?? { type: 'all' as const };
  return (
    <form action={saveRuleAction} className={a.form} data-rule-form>
      <h2 className={a.formTitle}>{rule ? `ویرایش قاعده: ${rule.name}` : 'قاعده‌ی جدید'}</h2>
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <div className={a.grid}>
        <label className={a.field}>
          نام قاعده
          <input name="name" defaultValue={rule?.name ?? ''} maxLength={80} required />
        </label>
        <label className={a.field}>
          سطح معرف (۱ = معرف مستقیم خریدار)
          <input
            name="level"
            defaultValue={rule?.level ?? ''}
            inputMode="numeric"
            dir="ltr"
            required
            placeholder={`1 تا ${MAX_LEVEL}`}
          />
        </label>
        <label className={a.field}>
          محدوده
          <select name="scope" defaultValue={scope.type}>
            {Object.entries(SCOPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={a.field}>
          شناسه‌ی محدوده (کد دسته / کد برند / شناسه‌ی محصول؛ برای «همه» خالی)
          <input name="scopeId" defaultValue={'id' in scope ? scope.id : ''} inputMode="numeric" dir="ltr" />
        </label>
        <label className={a.field}>
          نوع
          <select name="kind" defaultValue={rule?.kind ?? 'percent'}>
            <option value="percent">درصد از قیمت فروش کالا (بدون ارسال)</option>
            <option value="fixed">مبلغ ثابت در هر سفارش (تومان)</option>
          </select>
        </label>
        <label className={a.field}>
          مقدار (درصد یا تومان)
          <input name="value" defaultValue={rule?.value ?? ''} inputMode="decimal" dir="ltr" required />
        </label>
        <label className={a.field}>
          حداقل جمع سفارش (تومان؛ ۰ = بدون حداقل)
          <input
            name="minOrderTotal"
            defaultValue={rule?.minOrderTotal ?? ''}
            inputMode="numeric"
            dir="ltr"
            required
          />
        </label>
        <label className={a.field}>
          سقف پورسانت هر سفارش (تومان؛ خالی = بدون سقف)
          <input name="maxPerOrder" defaultValue={rule?.maxPerOrder ?? ''} inputMode="numeric" dir="ltr" />
        </label>
        <label className={a.field}>
          مدت نگهداری تا تأیید (روز بعد از «ارسال شد»)
          <input name="holdDays" defaultValue={rule?.holdDays ?? ''} inputMode="numeric" dir="ltr" required />
        </label>
        <label className={a.field}>
          شروع اعتبار (اختیاری)
          <input type="date" name="validFrom" defaultValue={day(rule?.validFrom)} dir="ltr" />
        </label>
        <label className={a.field}>
          پایان اعتبار (اختیاری)
          <input type="date" name="validTo" defaultValue={day(rule?.validTo)} dir="ltr" />
        </label>
      </div>
      <label className={a.check}>
        <input type="checkbox" name="active" value="1" defaultChecked={rule?.active ?? false} />
        <span>فعال</span>
      </label>
      <label className={a.check}>
        <input type="checkbox" name="manualApproval" value="1" defaultChecked={rule?.manualApproval ?? false} />
        <span>تأیید دستی: پورسانت این قاعده فقط پس از تأیید ادمین به کیف پول همکار واریز شود</span>
      </label>
      <p className={a.hint}>
        هیچ مقداری از قبل پر نشده است. شرط تأیید همیشه «بعد از ارسال شدن سفارش» است؛ پس از گذشتن مدت نگهداری، پورسانت خودکار (یا با تأیید ادمین برای قاعدهٔ دستی) به کیف پول واریز می‌شود. قاعده حذف نمی‌شود؛
        غیرفعالش کنید.
      </p>
      <div className={a.actions}>
        <Button type="submit">{rule ? 'ذخیره‌ی قاعده' : 'افزودن قاعده'}</Button>
        {rule && (
          <Button href={adminSettingsPath('commission')} variant="outline">
            انصراف
          </Button>
        )}
      </div>
    </form>
  );
}

function Simulator({ input, result }: { input: SimulatorInput | null; result: CommissionResult | null }) {
  const l = (i: number) => input?.lines[i - 1];
  return (
    <section className={a.form} aria-labelledby="sim-title" data-simulator>
      <h2 id="sim-title" className={a.formTitle}>
        شبیه‌ساز پورسانت (چیزی ثبت نمی‌شود)
      </h2>
      <form method="get" action={adminSettingsPath()} className={t.fields}>
        <input type="hidden" name="section" value="commission" />
        {[1, 2, 3].map((i) => (
          <div key={i} className={a.grid}>
            <label className={a.field}>
              کالای {formatNumber(i)}: مبلغ فروش (تومان)
              <input
                name={`l${i}.total`}
                defaultValue={l(i)?.lineTotal ?? ''}
                inputMode="numeric"
                dir="ltr"
              />
            </label>
            <label className={a.field}>
              شناسه‌ی محصول
              <input
                name={`l${i}.product`}
                defaultValue={l(i)?.productId || ''}
                inputMode="numeric"
                dir="ltr"
              />
            </label>
            <label className={a.field}>
              کد برند
              <input name={`l${i}.brand`} defaultValue={l(i)?.brandId ?? ''} inputMode="numeric" dir="ltr" />
            </label>
            <label className={a.field}>
              کد دسته‌ها (از دقیق‌تر به کلی‌تر، با کاما)
              <input name={`l${i}.cat`} defaultValue={l(i)?.categoryIds.join(',') ?? ''} dir="ltr" />
            </label>
          </div>
        ))}
        <div className={a.grid}>
          <label className={a.field}>
            تعداد سطح‌های زنجیره‌ی معرف
            <select name="depth" defaultValue={input?.chainDepth ?? 2}>
              {Array.from({ length: MAX_LEVEL + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {formatNumber(i)}
                </option>
              ))}
            </select>
          </label>
          <label className={a.field}>
            وضعیت سفارش
            <select name="status" defaultValue={input?.status ?? 'paid'}>
              <option value="paid">پرداخت‌شده</option>
              <option value="sent">ارسال‌شده</option>
              <option value="canceled">لغو</option>
              <option value="refunded">بازگشت وجه</option>
            </select>
          </label>
          <label className={a.field}>
            روزهای گذشته از ارسال (برای وضعیت «ارسال‌شده»)
            <input name="held" defaultValue={input?.holdPassedDays ?? 0} inputMode="numeric" dir="ltr" />
          </label>
        </div>
        <div className={a.actions}>
          <Button type="submit">محاسبه</Button>
        </div>
      </form>

      {result && (
        <div data-sim-result>
          <p className={a.hint}>جمع کالاها: {formatNumber(result.goodsTotal)} تومان</p>
          <div className={a.tableWrap}>
            <table className={a.table}>
              <thead>
                <tr>
                  <th>سطح</th>
                  <th>پورسانت (تومان)</th>
                  <th>مبنا</th>
                  <th>قاعده‌ها</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((it) => (
                  <tr key={it.level} data-sim-level={it.level}>
                    <td>{formatNumber(it.level)}</td>
                    <td data-sim-amount>{formatNumber(it.amount)}</td>
                    <td>{formatNumber(it.base)}</td>
                    <td>{it.ruleIds.map(formatNumber).join('، ')}</td>
                    <td>
                      {STATUS[it.status]}
                      {it.holdDays > 0 && ` · نگهداری ${formatNumber(it.holdDays)} روز`}
                    </td>
                  </tr>
                ))}
                {result.skipped.map((s) => (
                  <tr key={`s${s.level}`} data-sim-skipped={s.level}>
                    <td>{formatNumber(s.level)}</td>
                    <td colSpan={4}>{REASON[s.reason]}</td>
                  </tr>
                ))}
                {!result.items.length && !result.skipped.length && (
                  <tr>
                    <td colSpan={5}>خریدار معرف ندارد؛ پورسانتی ایجاد نمی‌شود.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

/** The rules table and form, and the simulator. Admins only (the page checks). No rule exists until the client adds one. */
export function CommissionPanel({
  rules,
  editing,
  sim,
  simResult,
}: {
  rules: CommissionRule[];
  editing: CommissionRule | null;
  sim: SimulatorInput | null;
  simResult: CommissionResult | null;
}) {
  return (
    <>
      {!rules.length && (
        <Alert tone="warning">
          هنوز هیچ قاعده‌ای ثبت نشده است؛ تا قاعده‌ی فعالی نباشد پورسانتی ایجاد نمی‌شود.
        </Alert>
      )}
      {rules.length > 0 && (
        <div className={a.tableWrap} data-rules>
          <table className={a.table}>
            <thead>
              <tr>
                <th>نام</th>
                <th>سطح</th>
                <th>محدوده</th>
                <th>مقدار</th>
                <th>حداقل / سقف</th>
                <th>نگهداری</th>
                <th>وضعیت</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} data-rule={r.id}>
                  <td>{r.name}</td>
                  <td>{formatNumber(r.level)}</td>
                  <td>
                    {SCOPE_LABEL[r.scope.type]}
                    {'id' in r.scope && ` ${formatNumber(r.scope.id)}`}
                  </td>
                  <td>
                    {r.kind === 'percent' ? `${formatNumber(r.value)}٪` : `${formatNumber(r.value)} تومان`}
                  </td>
                  <td>
                    {formatNumber(r.minOrderTotal)} /{' '}
                    {r.maxPerOrder === null ? '—' : formatNumber(r.maxPerOrder)}
                  </td>
                  <td>{formatNumber(r.holdDays)} روز</td>
                  <td>{r.active ? 'فعال' : 'غیرفعال'}</td>
                  <td>
                    <Link href={`${adminSettingsPath('commission')}&edit=${r.id}`}>ویرایش</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RuleForm key={editing?.id ?? 'new'} rule={editing} />
      <Simulator input={sim} result={simResult} />
    </>
  );
}
