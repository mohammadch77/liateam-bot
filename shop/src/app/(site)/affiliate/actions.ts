'use server';

import { authorize } from '@/server/auth/guards';
import { runAction, type ActionResult } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { affiliateService } from '@/server/services/affiliate.service';

export type AffiliateState = ActionResult<{ status: 'pending' }> | null;

const FIELDS = [
  'fullName',
  'province',
  'city',
  'channelType',
  'channelUrl',
  'followers',
  'description',
  'terms',
  'source',
];

/** «ثبت درخواست همکاری»: signed-in (OTP-verified) users only; stored as pending until an admin decides. */
export async function applyAffiliateAction(_prev: AffiliateState, form: FormData): Promise<AffiliateState> {
  return runAction('affiliate.apply', async () => {
    const user = await authorize();
    const input = Object.fromEntries(
      FIELDS.map((k) => [k, typeof form.get(k) === 'string' ? (form.get(k) as string) : undefined]),
    );
    const { status } = await affiliateService.submit(user, input, await requestMeta());
    return { status };
  });
}
