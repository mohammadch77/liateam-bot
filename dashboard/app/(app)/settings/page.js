import { q } from '@/lib/db';
import { getStatus, getSettings, getCategories } from '@/lib/data';
import { dateTime, ago } from '@/lib/format';
import DbError from '../../components/DbError';
import SettingsForm from './SettingsForm';
import MessengerCard from './MessengerCard';

export const dynamic = 'force-dynamic';

// config.mjs defaults, used only until the bot reports its effective config.
const DEFAULTS = { excludedCategories: [199, 124], sellableOverrides: [], priceJumpLimit: 0.5, intervalHours: 4 };
const LABEL = { excludedCategories: 'دسته‌های مستثنا', sellableOverrides: 'استثناهای قابل‌فروش', priceJumpLimit: 'آستانه‌ی جهش قیمت',
  intervalHours: 'فاصله‌ی اجرا (ساعت)', manual_run: 'اجرای دستی', telegramEnabled: 'ربات تلگرام', baleEnabled: 'ربات بله',
  messenger_invite: 'ساخت کد دعوت', messenger_role: 'تغییر نقش کاربر ربات', messenger_remove: 'حذف کاربر ربات' };
const show = (v, key) => (v == null ? '—' : typeof v === 'boolean' ? (v ? 'روشن' : 'خاموش') : key === 'messenger_invite' ? (v === 'admin' ? 'مدیر' : 'بیننده') : Array.isArray(v) ? (v.length ? v.join('، ') : 'خالی') : key === 'priceJumpLimit' ? `${Math.round(v * 100)}٪` : key === 'intervalHours' ? `${v} ساعت` : String(v));

export default async function SettingsPage() {
  let status, saved, categories, audit, chats, [pending] = [];
  try {
    [status, saved, categories, audit, [pending]] = await Promise.all([
      getStatus(), getSettings(), getCategories(),
      q('SELECT * FROM settings_audit ORDER BY id DESC LIMIT 50'),
      q('SELECT requested_at, requested_by FROM run_requests WHERE picked_at IS NULL ORDER BY id LIMIT 1'),
    ]);
    chats = await q('SELECT id, platform, display_name, role, notify, kinds, last_seen_at FROM messenger_chats ORDER BY linked_at').catch(() => []);
  } catch (e) {
    return <DbError error={e} />;
  }
  const values = { ...DEFAULTS, ...status.config, ...saved };
  const workerAlive = status.worker?.heartbeat && Date.now() - new Date(status.worker.heartbeat).getTime() < 120_000;

  return (
    <>
      <div className="page-head">
        <div><h1>تنظیمات</h1><div className="sub">هر تغییر پس از تأیید ذخیره و در گزارش تغییرات ثبت می‌شود. ربات از اجرای بعدی از آن استفاده می‌کند.</div></div>
      </div>
      {!workerAlive && (
        <div className="banner warn">
          worker ربات فعال نیست (آخرین علامت: {ago(status.worker?.heartbeat)}). «اجرای دستی» و «فاصله‌ی اجرا» فقط با <span className="mono">npm run worker</span> اعمال می‌شوند.
        </div>
      )}
      <SettingsForm values={values} categories={categories} pending={pending ? { at: dateTime(pending.requested_at), by: pending.requested_by } : null}
        account={{ username: status.credentials?.username_masked ?? null, passwordSet: status.credentials?.password_set ?? null }} />

      <MessengerCard
        status={{ telegram: status.messenger_telegram ?? null, bale: status.messenger_bale ?? null }}
        enabled={{ telegram: saved.telegramEnabled === true, bale: saved.baleEnabled === true }}
        chats={chats.map((c) => ({ ...c, last_seen_at: c.last_seen_at?.toISOString() ?? null }))} />

      <div className="card section">
        <h2>گزارش تغییرات (audit)</h2>
        {audit.length === 0 ? <div className="empty">تغییری ثبت نشده</div> : (
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table>
              <thead><tr><th>زمان</th><th>کاربر</th><th>چه چیزی</th><th>قبل</th><th>بعد</th></tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="tnum">{dateTime(a.at)}</td><td>{a.actor}</td><td>{LABEL[a.action] || a.action}</td>
                    <td className="mono sub">{show(a.old_value, a.action)}</td><td className="mono">{show(a.new_value, a.action)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
