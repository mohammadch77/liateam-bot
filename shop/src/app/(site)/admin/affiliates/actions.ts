'use server';

import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/guards';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { affiliateService } from '@/server/services/affiliate.service';

/** Approve (grants the «فروشنده‌ی همکار» role) or reject one pending application; admins only, audited. */
export async function decideAffiliateAction(form: FormData): Promise<void> {
  const decision = form.get('decision') === 'approve' ? 'approved' : 'rejected';
  const result = await runAction('affiliate.decide', async () => {
    const admin = await authorize('admin');
    return affiliateService.decide(
      admin,
      String(form.get('id') ?? ''),
      decision,
      String(form.get('reason') ?? ''),
      await requestMeta(),
    );
  });
  redirect(`/admin/affiliates?${result.ok ? `done=${decision}` : 'error=1'}`);
}
