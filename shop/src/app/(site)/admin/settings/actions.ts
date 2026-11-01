'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { GROUPS, type SettingGroup } from '@/lib/settings/registry';
import { adminSettingsPath } from '@/lib/urls';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { settingsService } from '@/server/services/settings.service';
import { shippingAdminService } from '@/server/services/shipping-admin.service';

/**
 * Admin settings actions: each saves one section (admins only, checked in the service; audited), makes the whole site
 * read the change on the next request, and returns to the section with the outcome. A secret's value is never put in
 * the redirect, the error or any log.
 */
const groupOf = (form: FormData): SettingGroup => {
  const g = String(form.get('group') ?? '');
  return (GROUPS.find((x) => x.id === g)?.id ?? 'general') as SettingGroup;
};

const back = (section: string, r: { ok: boolean; error?: string }, done = 'done') =>
  redirect(
    `${adminSettingsPath(section)}&${r.ok ? `${done}=1` : `error=${encodeURIComponent(r.error ?? '')}`}`,
  );

/** the pages that show a setting (header, cart, checkout) must not keep an older render */
const fresh = () => revalidatePath('/', 'layout');

export async function saveGroupAction(form: FormData): Promise<void> {
  const group = groupOf(form);
  const r = await runAction('settings.save', async () =>
    settingsService.save(group, form, await requestMeta()),
  );
  if (r.ok) fresh();
  back(group, r);
}

export async function saveShippingAction(form: FormData): Promise<void> {
  const r = await runAction('settings.shipping', async () =>
    shippingAdminService.save(form, await requestMeta()),
  );
  if (r.ok) fresh();
  back('shipping', r, 'shipped');
}

export async function setSecretAction(form: FormData): Promise<void> {
  const group = groupOf(form);
  const r = await runAction('settings.secret', async () =>
    settingsService.setSecret(
      String(form.get('key') ?? ''),
      String(form.get('value') ?? ''),
      await requestMeta(),
    ),
  );
  back(group, r, 'secret');
}
