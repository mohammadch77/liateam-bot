'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect } from 'react';
import { toFaDigits } from '@/lib/format/number';
import { Alert, Button } from '@/ui';
import a from '../admin-forms.module.css';
import { campaignFormAction, type CampaignFormState } from './actions';

export type CampaignDraft = {
  id: number | null;
  title: string;
  bannerText: string;
  endsAt: string;
  link: string;
  active: boolean;
};

/** New / edit campaign: the header bar text, its end (the countdown) and where the bar leads. */
export function CampaignForm({ draft }: { draft: CampaignDraft }) {
  const [state, action, pending] = useActionState<CampaignFormState, FormData>(campaignFormAction, {});
  const router = useRouter();
  // saved: the list beside the form is server-rendered, so read it again
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form
      // submitted by hand: a form `action` resets every field afterwards (React 19), which would empty the form
      // after «پیش‌نمایش» or an error; the pressed button (intent) travels with the data
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(data));
      }}
      className={a.form}
      aria-labelledby="campaign-form-title"
    >
      <h2 id="campaign-form-title" className={a.formTitle}>
        {draft.id ? `ویرایش کمپین #${toFaDigits(draft.id)}` : 'کمپین جدید'}
      </h2>
      {draft.id && <input type="hidden" name="id" value={draft.id} />}
      <div className={a.grid}>
        <label className={a.field}>
          <span>عنوان</span>
          <input
            name="title"
            defaultValue={draft.title}
            maxLength={80}
            required
            placeholder="جشنواره پاییزه"
          />
        </label>
        <label className={a.field}>
          <span>متن نوار بالای سایت</span>
          <input
            name="bannerText"
            defaultValue={draft.bannerText}
            maxLength={120}
            required
            placeholder="جشنواره پاییزه · تا ۳۰ مهر"
          />
        </label>
        <label className={a.field}>
          <span>پایان (وقت تهران)</span>
          <input name="endsAt" type="datetime-local" defaultValue={draft.endsAt} required dir="ltr" />
        </label>
        <label className={a.field}>
          <span>پیوند (مسیر داخلی)</span>
          <input name="link" defaultValue={draft.link} dir="ltr" placeholder="/offers" />
        </label>
        <label className={a.check}>
          <input type="checkbox" name="active" defaultChecked={draft.active} />
          <span>فعال</span>
        </label>
      </div>
      <p className={a.hint}>
        تخفیف‌هایی که به کمپین وصل‌اند فقط تا پایان کمپین و وقتی کمپین فعال است اعمال می‌شوند.
      </p>
      {state.message && <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>}
      <div className={a.actions}>
        <Button type="submit" icon="check" disabled={pending}>
          {draft.id ? 'ذخیره‌ی تغییرات' : 'ساخت کمپین'}
        </Button>
      </div>
    </form>
  );
}
