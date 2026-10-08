import localFont from 'next/font/local';
import './globals.css';

const vazir = localFont({ src: './fonts/Vazirmatn-Variable.woff2', variable: '--font-vazir', weight: '100 900', display: 'swap' });

export const metadata = { title: 'داشبورد لیاتیم', robots: { index: false, follow: false } };

// Applies the saved theme before paint (dark by default).
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="fa" dir="rtl" data-theme="dark" className={vazir.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
