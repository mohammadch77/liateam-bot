import type { Metadata } from 'next';
import Link from 'next/link';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { walletPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { accountService } from '@/server/services/account.service';
import { walletTopupService } from '@/server/services/wallet-topup.service';
import { withdrawalService } from '@/server/services/withdrawal.service';
import { Breadcrumb, EmptyState, Pagination } from '@/ui';
import s from '../account.module.css';
import { TopupForm, WithdrawalList, WithdrawForm } from './WalletForms';

export const metadata: Metadata = { title: 'کیف پول', robots: { index: false } };

const KIND_LABEL: Record<string, string> = {
  topup: 'شارژ کیف پول',
  order_payment: 'پرداخت سفارش',
  refund: 'بازگشت وجه سفارش',
  withdrawal: 'برداشت',
  withdrawal_return: 'بازگشت مبلغ برداشت',
  commission: 'پورسانت همکاری',
};
const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' });
const hrefFor = (page: number) => (page > 1 ? `${walletPath()}?page=${page}` : walletPath());

/**
 * The wallet: balance (for an affiliate also the withdrawable amount and what is held), the charge form for everyone, the
 * withdrawal form only for affiliates (the server checks again), and the ledger in pages.
 */
export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser(walletPath());
  const sp = await searchParams;
  const [data, topup, wd] = await Promise.all([
    accountService.wallet(user.id, Number(sp.page) || 1).catch(() => null),
    walletTopupService.options().catch(() => null),
    withdrawalService.overview(user).catch(() => null),
  ]);
  return (
    <>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'حساب کاربری', href: '/account' }, { label: 'کیف پول' }]}
      />
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
            {wd?.eligible && (
              <>
                <div className={s.stat}>
                  <span>قابل برداشت</span>
                  <b data-wallet-withdrawable>{formatToman(wd.withdrawable)} تومان</b>
                </div>
                <div className={s.stat}>
                  <span>در حال برداشت (نگه‌داشته‌شده)</span>
                  <b data-wallet-held>{formatToman(wd.held)} تومان</b>
                </div>
              </>
            )}
          </section>
          {topup && <TopupForm online={topup.online} min={topup.min} max={topup.max} presets={topup.presets} />}
          {wd?.eligible ? (
            <>
              <WithdrawForm min={wd.settings.min} max={wd.settings.max} withdrawable={wd.withdrawable} />
              <WithdrawalList
                items={wd.items.map((w) => ({
                  id: w.id,
                  amount: w.amount,
                  iban_last4: w.iban_last4,
                  holder_name: w.holder_name,
                  status: w.status,
                  paid_ref: w.paid_ref,
                  reject_reason: w.reject_reason,
                  created_at: w.created_at.toISOString(),
                }))}
              />
            </>
          ) : (
            <section className={`${s.card} ${s.wide}`} aria-label="برداشت" data-withdraw-locked>
              <h2 className={s.h2}>برداشت</h2>
              <p>برداشت مخصوص همکاران فروش است.</p>
              <Link href="/affiliate?from=account" className={s.adminLink}>
                همکاری در فروش
              </Link>
            </section>
          )}
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
                        {e.note && /^AV-/.test(e.note) ? ` · ${toFaDigits(e.note)}` : ''}
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
          <Pagination page={data.page} totalPages={data.pages} hrefFor={hrefFor} />
        </>
      )}
    </>
  );
}
