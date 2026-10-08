'use client';
export default function ThemeToggle() {
  const toggle = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
  };
  return <button className="btn btn-sm" onClick={toggle} type="button">تغییر تم روشن / تیره</button>;
}
