import 'server-only';
import { AppError } from '@/lib/errors';
import {
  commissionsTable,
  monthlyTotals,
  personTable,
  personTotals,
  reportSince,
  type CommissionExportRow,
  type MonthTotal,
  type PersonOrder,
  type ReportTable,
} from '@/lib/affiliate/report';
import { ORDER_STATUS_LABEL } from '@/lib/orders/filters';
import { readPersonToken, personToken } from '@/server/security/crypto';
import { siteOrigin } from '@/server/http/site-origin';
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
      commissionRepository.networkCount(user.id),
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

  /** The people this affiliate referred (one level), each with the opaque token of their page. */
  async network(user: CurrentUser, page: number) {
    need(user);
    const p = Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1;
    const [rows, total] = await Promise.all([
      commissionRepository.networkPage(user.id, NETWORK_PER_PAGE, (p - 1) * NETWORK_PER_PAGE),
      commissionRepository.networkCount(user.id),
    ]);
    return {
      rows: rows.map((r) => ({ ...r, token: personToken(user.id, r.buyer_id) })) as Array<NetworkRow & { token: string }>,
      total,
      page: p,
      pages: Math.max(1, Math.ceil(total / NETWORK_PER_PAGE)),
    };
  },

  /**
   * One referred person's paid orders and the commission each gave. Only the affiliate who referred them: a token that is not theirs,
   * or a person someone else referred, is a plain NOT_FOUND (never "forbidden", so nothing is confirmed).
   */
  async person(user: CurrentUser, token: string) {
    need(user);
    const buyerId = readPersonToken(user.id, token);
    const person = buyerId ? await commissionRepository.referredPerson(user.id, buyerId) : null;
    if (!buyerId || !person) throw new AppError('NOT_FOUND');
    const orders = (await commissionRepository.personOrders(user.id, buyerId, EXPORT_LIMIT)) as PersonOrder[];
    return { person, orders, totals: personTotals(orders) };
  },

  /** the table of one person's orders for Excel (rate limited like the other exports) */
  async personExport(user: CurrentUser, token: string): Promise<ReportTable> {
    rateLimit(`affiliate-csv:${user.id}`, 5, 10 * 60_000);
    const d = await affiliatePanelService.person(user, token);
    const name = d.person.first_name?.trim() || 'کاربر';
    return personTable(`${name} (${d.person.phone_last4})`, d.orders, (s) => ORDER_STATUS_LABEL[s as keyof typeof ORDER_STATUS_LABEL] ?? s);
  },

  /** the table of the user's own commissions for Excel (the page's filters) */
  async commissionsExport(user: CurrentUser, f: CommissionFilter): Promise<ReportTable> {
    const rows = await affiliatePanelService.exportRows(user, f);
    return commissionsTable(rows as CommissionExportRow[]);
  },

  /** the link a QR code points at: the shop's own address (the setting, else the address this request came on) */
  async qrLink(user: CurrentUser): Promise<{ code: string; link: string }> {
    need(user);
    const code = await affiliateRepository.ensureCode(user.id);
    const base = (await settingsRead.get('site.base_url')) || (await siteOrigin());
    return { code, link: `${String(base).replace(/\/+$/, '')}/r/${code}` };
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
