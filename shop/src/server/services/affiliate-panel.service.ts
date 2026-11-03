import 'server-only';
import { AppError } from '@/lib/errors';
import { monthlyTotals, reportSince, type MonthTotal } from '@/lib/affiliate/report';
import { rateLimit } from '@/server/http/rate-limit';
import { affiliateRepository } from '@/server/repositories/affiliate.repository';
import {
  commissionRepository,
  type AffiliateCommissionRow,
  type CommissionFilter,
  type CommissionStatus,
  type NetworkRow,
} from '@/server/repositories/commission.repository';
import { withdrawalService } from './withdrawal.service';
import { walletRepository } from '@/server/repositories/wallet.repository';
import { settingsRead } from './settings-read.service';
import type { CurrentUser } from './session.service';

/**
 * The sales affiliate's panel. Everything is read for the signed-in user only (every query carries the user id) and only
 * for a user who really is an affiliate: the role «affiliate» (an admin is not one by being admin), checked here on the server for
 * every call. A person in the network is shown as a first name, the last four digits of the number, the join date and how many
 * paid orders they have — never an address, an order or an item. The referral code is made on first use if the affiliate has none.
 */
export const COMMISSIONS_PER_PAGE = 20;
export const NETWORK_PER_PAGE = 20;
export const EXPORT_LIMIT = 5000;

const forbidden = () => new AppError('FORBIDDEN', { message: 'این بخش مخصوص همکاران فروش است.' });

/** the affiliate role itself (not the admin's implicit «every role») */
export const isAffiliateUser = (user: Pick<CurrentUser, 'roles'>): boolean => user.roles.includes('affiliate');

function need(user: CurrentUser): void {
  if (!isAffiliateUser(user)) throw forbidden();
}

const STATUSES: readonly CommissionStatus[] = ['pending', 'approved', 'paid', 'cancelled'];
const dayOk = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** the URL's filters → a typed filter (anything unknown is dropped) */
export function commissionFilterOf(sp: Record<string, string | string[] | undefined>): CommissionFilter {
  const s = typeof sp.status === 'string' ? sp.status : '';
  return {
    status: (STATUSES as readonly string[]).includes(s) ? (s as CommissionStatus) : null,
    from: dayOk(sp.from),
    to: dayOk(sp.to),
  };
}

export const affiliatePanelService = {
  async overview(user: CurrentUser) {
    need(user);
    const code = await affiliateRepository.ensureCode(user.id);
    const [totals, network, balance, wd, base] = await Promise.all([
      commissionRepository.totalsForAffiliate(user.id),
      commissionRepository.networkCounts(user.id),
      walletRepository.balance(user.id),
      withdrawalService.overview(user),
      settingsRead.get('site.base_url'),
    ]);
    return {
      code,
      link: base ? `${base}/r/${code}` : `/r/${code}`,
      totals,
      network,
      balance,
      withdrawable: wd.eligible ? wd.withdrawable : 0,
    };
  },

  async network(user: CurrentUser, level: number | null, page: number) {
    need(user);
    const p = Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1;
    const lv = level !== null && Number.isInteger(level) && level >= 1 && level <= 5 ? level : null;
    const [rows, counts] = await Promise.all([
      commissionRepository.networkPage(user.id, lv, NETWORK_PER_PAGE + 1, (p - 1) * NETWORK_PER_PAGE),
      commissionRepository.networkCounts(user.id),
    ]);
    const total = lv ? counts[lv - 1]! : counts.reduce((a, b) => a + b, 0);
    return {
      rows: rows.slice(0, NETWORK_PER_PAGE) as NetworkRow[],
      counts,
      page: p,
      pages: Math.max(1, Math.ceil(total / NETWORK_PER_PAGE)),
      level: lv,
    };
  },

  async commissions(user: CurrentUser, f: CommissionFilter, page: number) {
    need(user);
    const p = Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1;
    const r = await commissionRepository.pageForAffiliate(user.id, f, COMMISSIONS_PER_PAGE, (p - 1) * COMMISSIONS_PER_PAGE);
    const pageSum = r.rows.filter((x) => x.status !== 'cancelled').reduce((a, x) => a + x.amount, 0);
    return {
      rows: r.rows as AffiliateCommissionRow[],
      page: p,
      pages: Math.max(1, Math.ceil(r.total / COMMISSIONS_PER_PAGE)),
      total: r.total,
      pageSum,
      filterSum: r.sumOfFilter,
    };
  },

  /** the last twelve Persian months */
  async monthly(user: CurrentUser, now: Date = new Date()): Promise<MonthTotal[]> {
    need(user);
    const days = await commissionRepository.dailyForAffiliate(user.id, reportSince(now));
    return monthlyTotals(days, now);
  },

  /** the CSV rows of the user's OWN commissions (rate limited: it reads up to EXPORT_LIMIT rows) */
  async exportRows(user: CurrentUser, f: CommissionFilter) {
    need(user);
    rateLimit(`affiliate-csv:${user.id}`, 5, 10 * 60_000);
    return commissionRepository.exportForAffiliate(user.id, f, EXPORT_LIMIT);
  },
};
