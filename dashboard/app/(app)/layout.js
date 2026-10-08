import { requireUser } from '@/lib/auth';
import Nav from '../components/Nav';
import ThemeToggle from '../components/ThemeToggle';
import { logout } from '../login/actions';

export default async function AppLayout({ children }) {
  const user = await requireUser();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="brand-dot" />همگام‌ساز لیاتیم</div>
        <Nav />
        <div className="side-foot">
          <ThemeToggle />
          <span>کاربر: {user}</span>
          <form action={logout}><button className="btn btn-sm" style={{ width: '100%' }}>خروج</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
