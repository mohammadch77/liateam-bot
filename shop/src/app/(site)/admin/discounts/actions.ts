'use server';

import { redirect } from 'next/navigation';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { discountService, type DiscountPreview } from '@/server/services/discount.service';

export type DiscountFormState = {
  ok?: boolean;
  message?: string;
  preview?: DiscountPreview;
  savedId?: number;
};

const fields = (form: FormData) => ({
  scope: String(form.get('scope') ?? ''),
  target: String(form.get('target') ?? ''),
  kind: String(form.get('kind') ?? ''),
  value: String(form.get('value') ?? ''),
  startsAt: String(form.get('startsAt') ?? ''),
  endsAt: String(form.get('endsAt') ?? ''),
  label: String(form.get('label') ?? ''),
  campaign: String(form.get('campaign') ?? ''),
  active: form.get('active') ? 'on' : undefined,
});

/** «پیش‌نمایش» or «ذخیره» (button name=intent); admins only, audited on save. Errors are safe Persian text. */
export async function discountFormAction(_: DiscountFormState, form: FormData): Promise<DiscountFormState> {
  const id = Number(form.get('id')) || null;
  const raw = fields(form);
  if (form.get('intent') === 'preview') {
    const r = await runAction('discount.preview', () => discountService.preview(raw));
    return r.ok ? { ok: true, preview: r.data } : { ok: false, message: r.error };
  }
  const r = await runAction('discount.save', async () => discountService.save(id, raw, await requestMeta()));
  return r.ok
    ? { ok: true, savedId: r.data, message: id ? 'تخفیف به‌روز شد.' : 'تخفیف ساخته شد.' }
    : { ok: false, message: r.error };
}

export async function toggleDiscountAction(form: FormData): Promise<void> {
  const id = Number(form.get('id'));
  const active = form.get('active') === '1';
  const r = await runAction('discount.toggle', async () =>
    discountService.setActive(id, active, await requestMeta()),
  );
  redirect(`/admin/discounts?${r.ok ? `done=${active ? 'on' : 'off'}` : `error=${r.code}`}`);
}
