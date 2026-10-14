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
    // JavaScript is on: the manual submit button is not needed.
    form.querySelectorAll<HTMLElement>('[data-nojs-submit]').forEach((b) => (b.hidden = true));
    return () => form.removeEventListener('change', onChange);
  }, []);
  return <span ref={ref} hidden />;
}
