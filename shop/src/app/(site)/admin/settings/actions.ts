'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { GROUPS, type SettingGroup } from '@/lib/settings/registry';
import { adminSettingsPath } from '@/lib/urls';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { commissionService } from '@/server/services/commission.service';
import { paymentService } from '@/server/services/payment.service';
import { settingsService } from '@/server/services/settings.service';
import { shippingAdminService } from '@/server/services/shipping-admin.service';
import { smsService } from '@/server/services/sms.service';

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

/** the outcome of a test, shown on the section: ?test=ok|fail&msg=... (the message never holds a secret) */
const tested = (section: string, r: { ok: boolean; message: string }) =>
  redirect(`${adminSettingsPath(section)}&test=${r.ok ? 'ok' : 'fail'}&msg=${encodeURIComponent(r.message)}`);

/** «تست اتصال»: a harmless check of what is saved for the payment gateway (no transaction) */
export async function testPaymentAction(): Promise<void> {
  const r = await runAction('settings.payment_test', async () =>
    paymentService.testConnection(await requestMeta()),
  );
  if (!r.ok) back('payment', r);
  else tested('payment', r.data);
}

/** «ارسال آزمایشی»: one test SMS to the signed-in admin's own number (rate-limited) */
export async function testSmsAction(): Promise<void> {
  const r = await runAction('settings.sms_test', async () => smsService.sendTest(await requestMeta()));
  if (!r.ok) back('sms', r);
  else tested('sms', r.data);
}

/** create (no id) or edit a commission rule */
export async function saveRuleAction(form: FormData): Promise<void> {
  const raw = String(form.get('id') ?? '');
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const r = await runAction('commission.rule_save', async () =>
    commissionService.save(id, form, await requestMeta()),
  );
  if (!r.ok) {
    const edit = id ? `&edit=${id}` : '';
    redirect(`${adminSettingsPath('commission')}${edit}&error=${encodeURIComponent(r.error)}`);
  }
  redirect(`${adminSettingsPath('commission')}&done=1`);
}
