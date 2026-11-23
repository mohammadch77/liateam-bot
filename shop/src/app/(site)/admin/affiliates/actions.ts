'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/guards';
import { runAction, type ActionResult } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { affiliateProgramService } from '@/server/services/affiliate-program.service';
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

/** Save global affiliate thresholds & progressive sales tiers (applies to everyone without a personal override). */
export async function saveGlobalAffiliateConfigAction(form: FormData): Promise<ActionResult<null>> {
  return runAction('affiliate.save_global_config', async () => {
    const admin = await authorize('admin');
    await affiliateProgramService.saveGlobalConfig(
      admin.id,
      {
        joinMinMonthlyToman: form.get('joinMinMonthlyToman'),
        activeMinMonthlyToman: form.get('activeMinMonthlyToman'),
        tiersJson: form.get('tiersJson'),
      },
      await requestMeta(),
    );
    revalidatePath('/admin/affiliates');
    revalidatePath('/account/affiliate');
    revalidatePath('/affiliate');
    return null;
  });
}

/** Save or create a per-user custom override (by userId or phone number). Empty fields inherit global config. */
export async function saveUserAffiliateOverrideAction(form: FormData): Promise<ActionResult<{ userId: string }>> {
  return runAction('affiliate.save_user_override', async () => {
    const admin = await authorize('admin');
    const res = await affiliateProgramService.saveUserOverride(
      admin.id,
      {
        userId: String(form.get('userId') ?? ''),
        phone: String(form.get('phone') ?? ''),
        joinMinMonthlyToman: form.get('joinMinMonthlyToman'),
        activeMinMonthlyToman: form.get('activeMinMonthlyToman'),
        useCustomTiers: form.get('useCustomTiers') === '1',
        tiersJson: form.get('tiersJson'),
        note: form.get('note'),
      },
      await requestMeta(),
    );
    revalidatePath('/admin/affiliates');
    revalidatePath('/account/affiliate');
    revalidatePath('/affiliate');
    return res;
  });
}

/** Reset a user's custom affiliate settings back to the global defaults. */
export async function resetUserAffiliateOverrideAction(form: FormData): Promise<ActionResult<null>> {
  return runAction('affiliate.reset_user_override', async () => {
    const admin = await authorize('admin');
    await affiliateProgramService.resetUserOverride(
      admin.id,
      String(form.get('userId') ?? ''),
      await requestMeta(),
    );
    revalidatePath('/admin/affiliates');
    revalidatePath('/account/affiliate');
    revalidatePath('/affiliate');
    return null;
  });
}
