import { requireUser } from '@/lib/auth';
import Nav from '../components/Nav';
import ThemeToggle from '../components/ThemeToggle';
import { logout } from '../login/actions';

export default async function AppLayout({ children }) {
  const user = await requireUser();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="brand-dot" /><div>ربات لیاتیم<div className="side-meta" style={{ fontWeight: 400 }}>همگام‌ساز قیمت و موجودی</div></div></div>
        <Nav />
        <div className="side-foot">
          <div className="side-meta">
            آخرین دیپلوی: {new Date(process.env.BUILD_TIME).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'long' })}<br />
            نسخه {String(process.env.APP_VERSION).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])}{process.env.SERVER_LABEL ? ` · ${process.env.SERVER_LABEL}` : ''}
          </div>
          <ThemeToggle />
          <span>کاربر: {user}</span>
          <form action={logout}><button className="btn btn-sm" style={{ width: '100%' }}>خروج</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
