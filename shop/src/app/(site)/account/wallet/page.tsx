import type { Metadata } from 'next';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { walletPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { accountService } from '@/server/services/account.service';
import { Badge, Breadcrumb, Button, EmptyState } from '@/ui';
import s from '../account.module.css';

export const metadata: Metadata = { title: 'کیف پول', robots: { index: false } };

const KIND_LABEL: Record<string, string> = {
  topup: 'شارژ کیف پول',
  order_payment: 'پرداخت سفارش',
  refund: 'بازگشت وجه سفارش',
  withdrawal: 'برداشت',
  commission: 'پورسانت همکاری',
};
const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' });

/** The wallet: the balance and the ledger (newest first). Charging and withdrawing come later (shown disabled). */
export default async function WalletPage() {
  const user = await requireUser(walletPath());
  const data = await accountService.wallet(user.id).catch(() => null);
  return (
    <>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'حساب کاربری', href: '/account' }, { label: 'کیف پول' }]} />
      <h1 className={s.title}>کیف پول</h1>
      {!data ? (
        <EmptyState icon="error" tone="danger" title="کیف پول بارگذاری نشد">
          چند لحظه بعد دوباره تلاش کنید.
        </EmptyState>
      ) : (
        <>
          <section className={s.stats} aria-label="موجودی">
            <div className={s.stat}>
              <span>موجودی</span>
              <b data-wallet-balance>{formatToman(data.balance)} تومان</b>
            </div>
            <div className={s.btnRow}>
              <Button variant="outline" disabled data-wallet-topup>
                شارژ کیف پول <Badge tone="soon">به‌زودی</Badge>
              </Button>
              <Button variant="outline" disabled data-wallet-withdraw>
                برداشت <Badge tone="soon">به‌زودی</Badge>
              </Button>
            </div>
          </section>
          <section className={`${s.card} ${s.wide}`} aria-label="تراکنش‌ها">
            <h2 className={s.h2}>تراکنش‌ها</h2>
            {data.entries.length === 0 ? (
              <EmptyState icon="account_balance_wallet" title="هنوز تراکنشی ندارید" />
            ) : (
              <ul className={s.rows}>
                {data.entries.map((e) => (
                  <li key={e.id} className={s.row} data-wallet-entry={e.kind}>
                    <div className={s.rowMain}>
                      <b>{KIND_LABEL[e.kind] ?? e.kind}</b>
                      <span className={s.muted}>
                        {dateFa.format(e.created_at)}
                        {e.note ? ` · ${toFaDigits(e.note)}` : ''}
                      </span>
                    </div>
                    <span className={`${s.amount} ${e.amount >= 0 ? s.plus : s.minus}`} dir="ltr">
                      {e.amount >= 0 ? '+' : '−'}
                      {formatToman(Math.abs(e.amount))}
                    </span>
                    <span className={s.muted}>مانده: {formatToman(e.balance_after)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
