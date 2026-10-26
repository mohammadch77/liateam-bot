'use client';

import { useEffect, useRef } from 'react';

/**
 * Submits the surrounding GET form as soon as a select or checkbox changes, so filters apply instantly.
 * Without JavaScript the form's own «اعمال» button does the same.
 */
export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onChange = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.matches('select, input[type=checkbox], input[type=radio]')) form.requestSubmit();
    };
    form.addEventListener('change', onChange);
    // an empty price field is not part of the address (?min=&max= stayed in every filtered URL); a page restored from
    // the back/forward cache gets its fields back
    const named = () => form.querySelectorAll<HTMLInputElement>('input[name=min], input[name=max]');
    const onSubmit = () => named().forEach((i) => (i.disabled = !i.value.trim()));
    const onShow = () => named().forEach((i) => (i.disabled = false));
    form.addEventListener('submit', onSubmit);
    window.addEventListener('pageshow', onShow);
    // JavaScript is on: the manual submit button is not needed.
    form.querySelectorAll<HTMLElement>('[data-nojs-submit]').forEach((b) => (b.hidden = true));
    return () => {
      form.removeEventListener('change', onChange);
      form.removeEventListener('submit', onSubmit);
      window.removeEventListener('pageshow', onShow);
    };
  }, []);
  return <span ref={ref} hidden />;
}
