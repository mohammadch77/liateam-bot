'use server';

import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { discountService } from '@/server/services/discount.service';

export type CampaignFormState = { ok?: boolean; message?: string };

/** New / edit campaign; admins only, audited. */
export async function campaignFormAction(_: CampaignFormState, form: FormData): Promise<CampaignFormState> {
  const id = Number(form.get('id')) || null;
  const raw = {
    title: String(form.get('title') ?? ''),
    bannerText: String(form.get('bannerText') ?? ''),
    endsAt: String(form.get('endsAt') ?? ''),
    link: String(form.get('link') ?? ''),
    active: form.get('active') ? 'on' : undefined,
  };
  const r = await runAction('campaign.save', async () =>
    discountService.saveCampaign(id, raw, await requestMeta()),
  );
  return r.ok
    ? { ok: true, message: id ? 'کمپین به‌روز شد.' : 'کمپین ساخته شد.' }
    : { ok: false, message: r.error };
}
