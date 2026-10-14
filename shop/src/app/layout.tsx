import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
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

export const metadata: Metadata = {
  title: 'فروشگاه',
  robots: { index: false, follow: false }, // until launch
};

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
