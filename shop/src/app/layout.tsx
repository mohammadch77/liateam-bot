import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { indexingBlocked } from '@/server/seo-policy';
import { color, cssVariables } from '@/ui/tokens';
import '@/ui/global.css';

// Vazirmatn variable (300–900), self-hosted: no dependency on Google Fonts from Iran.
const vazirmatn = localFont({
  src: './fonts/Vazirmatn-Variable.woff2',
  weight: '300 900',
  display: 'swap',
  variable: '--font-vazirmatn',
  fallback: ['Tahoma', 'sans-serif'],
});

/** Search engines: kept out outside production and while the admin's «جلوگیری از ایندکس شدن» is on (default). */
export async function generateMetadata(): Promise<Metadata> {
  const blocked = await indexingBlocked();
  return {
    title: 'فروشگاه',
    robots: blocked ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: color.surface,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable}>
      <head>
        {/* Design tokens (src/ui/tokens.ts) as CSS custom properties — one source for CSS and TS. */}
        <style id="design-tokens" dangerouslySetInnerHTML={{ __html: cssVariables() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
