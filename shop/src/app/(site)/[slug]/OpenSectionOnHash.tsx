'use client';

import { useEffect } from 'react';

/**
 * Phones show the product sections as folded accordions. A link to one of them (#reviews after signing in to write
 * a review, «۳۲ دیدگاه» / «۵ پرسش» in the rating line) opens it, on load and on every hash change.
 */
export function OpenSectionOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      const section = el?.closest('details[data-section]');
      if (section instanceof HTMLDetailsElement && !section.open) {
        section.open = true;
        el?.scrollIntoView({ block: 'start' });
      }
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  return null;
}
