'use client';

import { useEffect } from 'react';

/**
 * Marks the in-page tab of the section being read (aria-current, underlined by product.module.css): the last
 * section whose top has passed just below the sticky tab bar. Without JavaScript the tabs are plain anchors.
 */
export function ActiveTab() {
  useEffect(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('nav[data-tabs] a[href^="#"]')];
    const sections = links.map((a) => document.getElementById(a.hash.slice(1)));
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = -1;
      sections.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= 90) current = i;
      });
      links.forEach((a, i) => {
        if (i === current) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
