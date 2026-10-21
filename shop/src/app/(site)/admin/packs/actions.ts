'use server';

import { redirect } from 'next/navigation';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { packService, PACK_POLICY, type PackPreview } from '@/server/services/pack.service';

export type PackFormState = { ok?: boolean; message?: string; preview?: PackPreview; savedId?: number };
export type CollectionFormState = { ok?: boolean; message?: string };

const text = (form: FormData, k: string) => String(form.get(k) ?? '');

function packFields(form: FormData) {
  return {
    collectionId: text(form, 'collectionId'),
    variantKey: text(form, 'variantKey'),
    variantTitle: text(form, 'variantTitle'),
    title: text(form, 'title'),
    description: text(form, 'description'),
    discountKind: text(form, 'discountKind'),
    discountValue: text(form, 'discountValue'),
    active: form.get('active') ? 'on' : undefined,
    allowLoss: form.get('allowLoss') ? 'on' : undefined,
    startsAt: text(form, 'startsAt'),
    endsAt: text(form, 'endsAt'),
    sortOrder: text(form, 'sortOrder'),
    steps: Array.from({ length: PACK_POLICY.maxSteps }, (_, i) => ({
      label: text(form, `step${i}Label`),
      product: text(form, `step${i}Product`),
    })),
  };
}

/** «پیش‌نمایش» or «ذخیره» (button name=intent); admins only, audited on save. */
export async function packFormAction(_: PackFormState, form: FormData): Promise<PackFormState> {
  const id = Number(form.get('id')) || null;
  const raw = packFields(form);
  if (form.get('intent') === 'preview') {
    const r = await runAction('pack.preview', () => packService.previewPack(raw));
    return r.ok ? { ok: true, preview: r.data } : { ok: false, message: r.error };
  }
  const r = await runAction('pack.save', async () => packService.savePack(id, raw, await requestMeta()));
  return r.ok
    ? { ok: true, savedId: r.data, message: id ? 'پک به‌روز شد.' : 'پک ساخته شد.' }
    : { ok: false, message: r.error };
}

export async function collectionFormAction(
  _: CollectionFormState,
  form: FormData,
): Promise<CollectionFormState> {
  const id = Number(form.get('id')) || null;
  const raw = {
    slug: text(form, 'slug'),
    title: text(form, 'title'),
    variantLabel: text(form, 'variantLabel'),
    active: form.get('active') ? 'on' : undefined,
    sortOrder: text(form, 'sortOrder'),
  };
  const r = await runAction('pack_collection.save', async () =>
    packService.saveCollection(id, raw, await requestMeta()),
  );
  return r.ok
    ? { ok: true, message: id ? 'مجموعه به‌روز شد.' : 'مجموعه ساخته شد.' }
    : { ok: false, message: r.error };
}

export async function togglePackAction(form: FormData): Promise<void> {
  const id = Number(form.get('id'));
  const active = form.get('active') === '1';
  const r = await runAction('pack.toggle', async () =>
    packService.setPackActive(id, active, await requestMeta()),
  );
  redirect(`/admin/packs?${r.ok ? `done=${active ? 'on' : 'off'}` : 'error=1'}`);
}
