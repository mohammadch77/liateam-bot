'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';

const fa = new Intl.NumberFormat('fa-IR');
const label = (iso) => new Date(iso).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function RunsChart({ runs }) {
  if (!runs.length) return <div className="empty">هنوز اجرایی ثبت نشده</div>;
  return (
    <div style={{ width: '100%', height: 260, direction: 'ltr' }}>
      <ResponsiveContainer>
        <BarChart data={runs} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="started_at" tickFormatter={label} tick={{ fill: 'var(--muted)', fontSize: 11 }} reversed />
          <YAxis orientation="right" tickFormatter={(v) => fa.format(v)} tick={{ fill: 'var(--muted)', fontSize: 11 }} width={40} />
          <Tooltip labelFormatter={label} formatter={(v, n) => [fa.format(v), n]}
            contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, direction: 'rtl', fontFamily: 'inherit' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="fetched" name="خوانده" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="sellable" name="قابل‌فروش" fill="var(--ok)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="rejected" name="رد" fill="var(--bad)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
