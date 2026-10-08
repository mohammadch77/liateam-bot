'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const LINKS = [
  ['/', 'نمای کلی', '◧'],
  ['/products', 'محصولات', '▦'],
  ['/changes', 'تغییرات محصولات', '⇅'],
  ['/runs', 'اجراها و هشدار', '↻'],
  ['/settings', 'تنظیمات', '⚙'],
];

/** recent = [{id}] of the latest change events; the badge counts those newer than what this browser has seen. */
export default function Nav({ recentIds = [] }) {
  const path = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const update = () => {
      let seen = 0;
      try { seen = Number(localStorage.getItem('eventsSeen') || 0); } catch {}
      setUnread(recentIds.filter((id) => id > seen).length);
    };
    update();
    window.addEventListener('events-seen', update);
    return () => window.removeEventListener('events-seen', update);
  }, [recentIds]);
  return LINKS.map(([href, label, icon]) => (
    <Link key={href} href={href} className={`nav-link${path === href ? ' active' : ''}`}>
      <span aria-hidden>{icon}</span>{label}
      {href === '/changes' && unread > 0 && (
        <span className="nav-count">{unread > 99 ? '۹۹+' : new Intl.NumberFormat('fa-IR').format(unread)}</span>
      )}
    </Link>
  ));
}
