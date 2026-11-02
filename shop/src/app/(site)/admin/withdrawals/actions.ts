'use server';

import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/guards';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { withdrawalService } from '@/server/services/withdrawal.service';

/** «پرداخت شد» (with the bank's tracking code) or «رد» (with a reason, the amount returns); admins only, audited. */
export async function decideWithdrawalAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const paid = form.get('decision') === 'paid';
  const r = await runAction('withdrawal.decide', async () => {
    await authorize('admin');
    const meta = await requestMeta();
    return paid
      ? withdrawalService.markPaid(id, String(form.get('ref') ?? ''), meta)
      : withdrawalService.reject(id, String(form.get('reason') ?? ''), meta);
  });
  redirect(
    r.ok ? `/admin/withdrawals?done=${paid ? 'paid' : 'rejected'}` : `/admin/withdrawals?error=${encodeURIComponent(r.error)}`,
  );
}
