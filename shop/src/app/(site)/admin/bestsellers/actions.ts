'use server';

import { redirect } from 'next/navigation';
import { isTabKey } from '@/lib/bestsellers';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { bestsellerService } from '@/server/services/bestseller.service';

/** Every panel button: admins only (checked in the service), audited, back to the same tab with the outcome. */
const back = (tab: string, r: { ok: boolean; error?: string }, done: string) =>
  redirect(
    `/admin/bestsellers?tab=${isTabKey(tab) ? tab : 'all'}&${r.ok ? `done=${done}` : `error=${encodeURIComponent(r.error ?? '')}`}`,
  );

export async function addPickAction(form: FormData): Promise<void> {
  const tab = String(form.get('tab') ?? '');
  const r = await runAction('bestseller.add', async () =>
    bestsellerService.addPick(tab, String(form.get('product') ?? ''), await requestMeta()),
  );
  back(tab, r, 'added');
}

export async function pickAction(form: FormData): Promise<void> {
  const tab = String(form.get('tab') ?? '');
  const id = Number(form.get('id'));
  const op = String(form.get('op') ?? '');
  const r = await runAction('bestseller.pick', async () => {
    const meta = await requestMeta();
    if (op === 'up' || op === 'down') await bestsellerService.movePick(id, op === 'up' ? -1 : 1, meta);
    else await bestsellerService.setPickEnabled(id, op === 'on', meta);
  });
  back(tab, r, op);
}

export async function useTagAction(form: FormData): Promise<void> {
  const tab = String(form.get('tab') ?? '');
  const on = form.get('on') === '1';
  const r = await runAction('bestseller.use_tag', async () =>
    bestsellerService.setUseLiateamTag(tab, on, await requestMeta()),
  );
  back(tab, r, on ? 'tag-on' : 'tag-off');
}
