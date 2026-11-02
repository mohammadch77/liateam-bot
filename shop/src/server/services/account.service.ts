import 'server-only';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { ORDER_FILTERS, type OrderFilterKey } from '@/lib/orders/filters';
import { authorize } from '@/server/auth/guards';
import { rateLimit } from '@/server/http/rate-limit';
import { orderRepository, type OrderRow } from '@/server/repositories/order.repository';
import { userRepository } from '@/server/repositories/user.repository';
import { walletRepository, type WalletEntryRow } from '@/server/repositories/wallet.repository';

/**
 * What the customer's panel shows. Every read takes the user id of the signed-in user (the pages pass their own), so another
 * user's orders or ledger are simply not in any result.
 */
export const ORDERS_PER_PAGE = 10;
export const WALLET_PER_PAGE = 15;

const nameSchema = z
  .string()
  .trim()
  .min(2, 'نام را بنویسید.')
  .max(120, 'نام بیش از حد طولانی است.')
  .refine((v) => !/[<>]/.test(v), 'نام معتبر نیست.');

export const accountService = {
  async summary(userId: string): Promise<{ active: number; balance: number; last: OrderRow | null }> {
    const [active, balance, recent] = await Promise.all([
      orderRepository.activeCountForUser(userId),
      walletRepository.balance(userId),
      orderRepository.pageForUser(userId, null, 1, 0),
    ]);
    return { active, balance, last: recent.rows[0] ?? null };
  },

  async orders(userId: string, filter: OrderFilterKey, page: number) {
    const p = Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1;
    const { rows, total } = await orderRepository.pageForUser(
      userId,
      ORDER_FILTERS[filter].statuses,
      ORDERS_PER_PAGE,
      (p - 1) * ORDERS_PER_PAGE,
    );
    return { rows, total, page: p, pages: Math.max(1, Math.ceil(total / ORDERS_PER_PAGE)) };
  },

  async wallet(
    userId: string,
    page: number,
  ): Promise<{ balance: number; entries: WalletEntryRow[]; page: number; pages: number }> {
    const p = Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1;
    const [balance, ledger] = await Promise.all([
      walletRepository.balance(userId),
      walletRepository.page(userId, WALLET_PER_PAGE, (p - 1) * WALLET_PER_PAGE),
    ]);
    return { balance, entries: ledger.rows, page: p, pages: Math.max(1, Math.ceil(ledger.total / WALLET_PER_PAGE)) };
  },

  /** the customer's name; the phone number is read-only */
  async updateName(raw: unknown): Promise<string> {
    const user = await authorize();
    rateLimit(`profile:${user.id}`, 10, 10 * 60_000);
    const parsed = nameSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError('INVALID_DATA', { message: parsed.error.issues[0]?.message ?? 'نام معتبر نیست.' });
    await userRepository.updateName(user.id, parsed.data);
    return parsed.data;
  },
};
