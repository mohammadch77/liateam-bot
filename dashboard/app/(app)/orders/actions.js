'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { runJob } from '@/lib/orders';

/** «ثبت و پرداخت» from the dashboard: the same job the Bale/Telegram button creates. */
export async function placeOrder(orderId) {
  const user = await requireUser();
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) return { error: 'شماره‌ی سفارش نامعتبر است' };
  await q(`INSERT INTO settings_audit (actor, action, new_value) VALUES ($1, 'place_order', $2)`, [user, JSON.stringify(id)]);
  const r = await runJob('place', { order_id: id }, `dashboard:${user}`, 90_000);
  revalidatePath('/orders');
  return r.ok ? { ok: true, ...r.result } : { error: r.result?.error ?? 'خطا' };
}
