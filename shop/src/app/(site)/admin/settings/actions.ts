'use server';

import { redirect } from 'next/navigation';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { siteSettingsService } from '@/server/services/site-settings.service';

/** Saves the settings page (admins only, checked in the service; audited) and returns to it with the outcome. */
export async function saveSettingsAction(form: FormData): Promise<void> {
  const r = await runAction('settings.save', async () =>
    siteSettingsService.update(
      {
        discountMode: form.get('discountMode') === 'excess' ? 'excess' : 'liateam',
        blockIndexing: form.get('blockIndexing') === '1',
      },
      await requestMeta(),
    ),
  );
  redirect(`/admin/settings?${r.ok ? 'done=1' : `error=${encodeURIComponent(r.error ?? '')}`}`);
}
