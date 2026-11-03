'use server';

import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/guards';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { commissionPayoutService } from '@/server/services/commission-payout.service';

/** «تأیید» (pays the commission into the affiliate's wallet now) or «لغو» (with a reason; a paid one cannot be cancelled); admins only, audited. */
export async function decideCommissionAction(form: FormData): Promise<void> {
  const id = String(form.get('id') ?? '');
  const approve = form.get('decision') === 'approve';
  const back = String(form.get('back') ?? '');
  const to = back.startsWith('/admin/commissions') ? back : '/admin/commissions';
  const r = await runAction('commission.decide', async () => {
    await authorize('admin');
    const meta = await requestMeta();
    return approve
      ? commissionPayoutService.approve(id, meta)
      : commissionPayoutService.cancel(id, String(form.get('reason') ?? ''), meta);
  });
  const sep = to.includes('?') ? '&' : '?';
  redirect(`${to}${sep}${r.ok ? `done=${approve ? 'approved' : 'cancelled'}` : `error=${encodeURIComponent(r.error)}`}`);
}
