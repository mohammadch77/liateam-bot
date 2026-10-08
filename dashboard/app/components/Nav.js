'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/', 'نمای کلی', '◧'],
  ['/products', 'محصولات', '▦'],
  ['/runs', 'اجراها و هشدار', '↻'],
  ['/settings', 'تنظیمات', '⚙'],
];

export default function Nav() {
  const path = usePathname();
  return LINKS.map(([href, label, icon]) => (
    <Link key={href} href={href} className={`nav-link${path === href ? ' active' : ''}`}>
      <span aria-hidden>{icon}</span>{label}
    </Link>
  ));
}
