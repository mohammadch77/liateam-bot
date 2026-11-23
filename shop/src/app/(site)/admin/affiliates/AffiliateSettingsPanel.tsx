'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import type { AffiliateTier } from '@/lib/affiliate/tiers';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import type {
  AffiliateGlobalConfigRow,
  ManagedAffiliateUserRow,
} from '@/server/repositories/affiliate-program.repository';
import { Alert, Button, TextField } from '@/ui';
import {
  resetUserAffiliateOverrideAction,
  saveGlobalAffiliateConfigAction,
  saveUserAffiliateOverrideAction,
} from './actions';
import a from './admin-affiliates.module.css';

export function AffiliateSettingsPanel({
  globalConfig,
  managedUsers,
}: {
  globalConfig: AffiliateGlobalConfigRow;
  managedUsers: ManagedAffiliateUserRow[];
}) {
  return (
    <div className={a.settingsStack}>
      <GlobalConfigEditor globalConfig={globalConfig} />
      <AddUserOverrideForm defaultTiers={globalConfig.tiers} />
      <ManagedUsersList users={managedUsers} globalConfig={globalConfig} />
    </div>
  );
}

function TiersListEditor({
  tiers,
  onChange,
}: {
  tiers: AffiliateTier[];
  onChange: (next: AffiliateTier[]) => void;
}) {
  const update = (idx: number, patch: Partial<AffiliateTier>) => {
    onChange(tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };
  const remove = (idx: number) => {
    if (tiers.length <= 1) return;
    onChange(tiers.filter((_, i) => i !== idx));
  };
  const add = () => {
    const last = tiers[tiers.length - 1];
    onChange([
      ...tiers,
      {
        title: `سطح ${toFaDigits(tiers.length + 1)}`,
        minSalesToman: (last?.minSalesToman ?? 0) + 20_000_000,
        commissionPercent: Math.min(100, (last?.commissionPercent ?? 5) + 3),
      },
    ]);
  };

  return (
    <div className={a.tiersEditor}>
      <div className={a.tiersHead}>
        <span className={a.tiersLabel}>پلکان سطح فروش و درصد پورسانت (ماهانه)</span>
        <Button type="button" size="sm" variant="outline" icon="add" onClick={add} disabled={tiers.length >= 8}>
          افزودن پله جدید
        </Button>
      </div>
      {tiers.map((t, idx) => (
        <div key={idx} className={a.tierRow}>
          <div className={a.miniInputWrap}>
            <label>عنوان سطح</label>
            <input
              type="text"
              className={a.miniInput}
              value={t.title}
              maxLength={40}
              onChange={(e) => update(idx, { title: e.target.value })}
              required
            />
          </div>
          <div className={a.miniInputWrap}>
            <label>حداقل فروش ماهانه (تومان)</label>
            <input
              type="text"
              inputMode="numeric"
              className={`${a.miniInput} ${a.miniInputLtr}`}
              value={String(t.minSalesToman)}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^\d]/g, '');
                update(idx, { minSalesToman: digits ? Number(digits) : 0 });
              }}
              required
            />
          </div>
          <div className={a.miniInputWrap}>
            <label>درصد پورسانت (٪)</label>
            <input
              type="text"
              inputMode="decimal"
              className={`${a.miniInput} ${a.miniInputLtr}`}
              value={String(t.commissionPercent)}
              onChange={(e) => {
                const val = Number(e.target.value.replace(/[^0-9.]/g, ''));
                update(idx, { commissionPercent: Number.isFinite(val) ? val : 0 });
              }}
              required
            />
          </div>
          <button
            type="button"
            className={a.removeBtn}
            onClick={() => remove(idx)}
            disabled={tiers.length <= 1}
          >
            حذف
          </button>
        </div>
      ))}
    </div>
  );
}

function GlobalConfigEditor({ globalConfig }: { globalConfig: AffiliateGlobalConfigRow }) {
  const router = useRouter();
  const [joinMin, setJoinMin] = useState(String(globalConfig.join_min_monthly_toman));
  const [activeMin, setActiveMin] = useState(String(globalConfig.active_min_monthly_toman));
  const [tiers, setTiers] = useState<AffiliateTier[]>(globalConfig.tiers);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData();
    fd.set('joinMinMonthlyToman', joinMin);
    fd.set('activeMinMonthlyToman', activeMin);
    fd.set('tiersJson', JSON.stringify(tiers));
    start(async () => {
      const r = await saveGlobalAffiliateConfigAction(fd);
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      setMsg({ tone: 'success', text: 'تنظیمات عمومی همکاری در فروش با موفقیت ذخیره شد.' });
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className={a.panelBox} data-affiliate-global-settings>
      <div className={a.panelHead}>
        <h2 className={a.panelTitle}>تنظیمات عمومی همکاری در فروش</h2>
        <span className={`${a.scopePill} ${a.scopeGlobal}`}>عمومی (همه کاربران)</span>
      </div>
      <p className={a.muted}>
        این مقادیر به‌صورت پیش‌فرض برای تمام مشتریان و همکاران فروش اعمال می‌شود؛ مگر اینکه برای فرد خاصی تنظیم
        اختصاصی ثبت شده باشد.
      </p>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className={a.fieldGrid}>
        <TextField
          label="سقف خرید شخصی ماهانه برای درخواست همکاری (تومان)"
          ltr
          inputMode="numeric"
          value={joinMin}
          onChange={(e) => setJoinMin(e.target.value)}
          hint="۰ = بدون شرط خرید اولیه"
        />
        <TextField
          label="حداقل خرید شخصی ماهانه همکار جهت تداوم همکاری (تومان)"
          ltr
          inputMode="numeric"
          value={activeMin}
          onChange={(e) => setActiveMin(e.target.value)}
          hint="خرید شخصی همکار به‌عنوان مشتری عادی در ۳۰ روز اخیر"
        />
      </div>

      <TiersListEditor tiers={tiers} onChange={setTiers} />

      <div className={a.actions}>
        <Button type="submit" loading={pending} loadingText="در حال ذخیره…">
          ذخیره تنظیمات عمومی
        </Button>
      </div>
    </form>
  );
}

function AddUserOverrideForm({ defaultTiers }: { defaultTiers: AffiliateTier[] }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [joinMin, setJoinMin] = useState('');
  const [activeMin, setActiveMin] = useState('');
  const [useCustomTiers, setUseCustomTiers] = useState(false);
  const [tiers, setTiers] = useState<AffiliateTier[]>(defaultTiers);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData();
    fd.set('phone', phone);
    fd.set('joinMinMonthlyToman', joinMin);
    fd.set('activeMinMonthlyToman', activeMin);
    fd.set('useCustomTiers', useCustomTiers ? '1' : '0');
    fd.set('tiersJson', JSON.stringify(tiers));
    fd.set('note', note);
    start(async () => {
      const r = await saveUserAffiliateOverrideAction(fd);
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      setMsg({ tone: 'success', text: 'تنظیمات اختصاصی برای کاربر با موفقیت ثبت شد.' });
      setPhone('');
      setJoinMin('');
      setActiveMin('');
      setNote('');
      setUseCustomTiers(false);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className={a.panelBox} data-affiliate-add-override>
      <div className={a.panelHead}>
        <h2 className={a.panelTitle}>تنظیم اختصاصی برای یک مشتری یا همکار خاص</h2>
        <span className={`${a.scopePill} ${a.scopeCustom}`}>شخصی‌سازی‌شده</span>
      </div>
      <p className={a.muted}>
        شماره موبایل هر مشتری یا همکار را وارد کنید و هر فیلدی را که می‌خواهید فقط برای او متفاوت باشد پر کنید
        (فیلدهای خالی از تنظیم عمومی پیروی می‌کنند).
      </p>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className={a.fieldGrid}>
        <TextField
          label="شماره موبایل کاربر"
          ltr
          inputMode="numeric"
          placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <TextField
          label="یادداشت ادمین (اختیاری)"
          placeholder="مثلاً: همکار ویژه مشهد"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <TextField
          label="سقف خرید ماهانه عضویت اختصاصی (تومان)"
          labelNote="خالی = عمومی"
          ltr
          inputMode="numeric"
          value={joinMin}
          onChange={(e) => setJoinMin(e.target.value)}
        />
        <TextField
          label="حداقل خرید شخصی ماهانه اختصاصی (تومان)"
          labelNote="خالی = عمومی"
          ltr
          inputMode="numeric"
          value={activeMin}
          onChange={(e) => setActiveMin(e.target.value)}
        />
      </div>

      <label className={a.checkRow}>
        <input
          type="checkbox"
          checked={useCustomTiers}
          onChange={(e) => setUseCustomTiers(e.target.checked)}
        />
        تعریف پلکان سطح فروش و درصد پورسانت اختصاصی برای این شخص
      </label>

      {useCustomTiers && <TiersListEditor tiers={tiers} onChange={setTiers} />}

      <div className={a.actions}>
        <Button type="submit" size="sm" loading={pending} loadingText="در حال ثبت…">
          ثبت تنظیم اختصاصی کاربر
        </Button>
      </div>
    </form>
  );
}

function ManagedUsersList({
  users,
  globalConfig,
}: {
  users: ManagedAffiliateUserRow[];
  globalConfig: AffiliateGlobalConfigRow;
}) {
  return (
    <div className={a.panelBox} data-affiliate-user-overrides>
      <div className={a.panelHead}>
        <h2 className={a.panelTitle}>همکاران فروش و کاربران دارای تنظیم اختصاصی ({toFaDigits(users.length)})</h2>
      </div>
      {users.length === 0 ? (
        <p className={a.muted}>هنوز همکار فروش یا تنظیم اختصاصی‌ای ثبت نشده است.</p>
      ) : (
        <div className={a.list}>
          {users.map((u) => (
            <ManagedUserRowEditor key={u.user_id} user={u} globalConfig={globalConfig} />
          ))}
        </div>
      )}
    </div>
  );
}

function ManagedUserRowEditor({
  user,
  globalConfig,
}: {
  user: ManagedAffiliateUserRow;
  globalConfig: AffiliateGlobalConfigRow;
}) {
  const router = useRouter();
  const hasAnyOverride =
    user.join_min_monthly_toman !== null ||
    user.active_min_monthly_toman !== null ||
    user.tiers !== null ||
    !!user.note;

  const [open, setOpen] = useState(false);
  const [joinMin, setJoinMin] = useState(
    user.join_min_monthly_toman !== null ? String(user.join_min_monthly_toman) : '',
  );
  const [activeMin, setActiveMin] = useState(
    user.active_min_monthly_toman !== null ? String(user.active_min_monthly_toman) : '',
  );
  const [useCustomTiers, setUseCustomTiers] = useState(user.tiers !== null);
  const [tiers, setTiers] = useState<AffiliateTier[]>(user.tiers ?? globalConfig.tiers);
  const [note, setNote] = useState(user.note ?? '');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData();
    fd.set('userId', user.user_id);
    fd.set('joinMinMonthlyToman', joinMin);
    fd.set('activeMinMonthlyToman', activeMin);
    fd.set('useCustomTiers', useCustomTiers ? '1' : '0');
    fd.set('tiersJson', JSON.stringify(tiers));
    fd.set('note', note);
    start(async () => {
      const r = await saveUserAffiliateOverrideAction(fd);
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      setMsg({ tone: 'success', text: 'تنظیمات این کاربر ذخیره شد.' });
      router.refresh();
    });
  };

  const onReset = () => {
    setMsg(null);
    const fd = new FormData();
    fd.set('userId', user.user_id);
    start(async () => {
      const r = await resetUserAffiliateOverrideAction(fd);
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      setJoinMin('');
      setActiveMin('');
      setUseCustomTiers(false);
      setTiers(globalConfig.tiers);
      setNote('');
      setMsg({ tone: 'success', text: 'تنظیمات کاربر به حالت عمومی بازگردانده شد.' });
      router.refresh();
    });
  };

  return (
    <div className={a.userCard} data-managed-user={user.user_id}>
      <div className={a.userTop}>
        <div className={a.userMeta}>
          <b>{user.full_name || 'بدون نام'}</b>
          <span dir="ltr" className={a.muted}>
            {toFaDigits(user.phone)}
          </span>
          <span className={`${a.scopePill} ${a.scopeRole}`}>
            {user.is_affiliate ? 'همکار فروش' : 'مشتری عادی'}
          </span>
          <span className={`${a.scopePill} ${hasAnyOverride ? a.scopeCustom : a.scopeGlobal}`}>
            {hasAnyOverride ? 'شخصی‌سازی‌شده' : 'عمومی'}
          </span>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? 'بستن ویرایش' : 'تنظیم اختصاصی'}
        </Button>
      </div>

      <div className={a.userStats}>
        <span>خرید شخصی ۳۰ روز: {formatToman(user.personal_30d)} تومان</span>
        <span>فروش معرفی‌شده ۳۰ روز: {formatToman(user.referred_sales_30d)} تومان</span>
        <span>
          سقف عضویت:{' '}
          {user.join_min_monthly_toman !== null
            ? `${formatToman(user.join_min_monthly_toman)} تومان (اختصاصی)`
            : `${formatToman(globalConfig.join_min_monthly_toman)} تومان (عمومی)`}
        </span>
        <span>
          حداقل ماهانه همکار:{' '}
          {user.active_min_monthly_toman !== null
            ? `${formatToman(user.active_min_monthly_toman)} تومان (اختصاصی)`
            : `${formatToman(globalConfig.active_min_monthly_toman)} تومان (عمومی)`}
        </span>
        <span>پلکان فروش: {user.tiers ? `${toFaDigits(user.tiers.length)} سطح (اختصاصی)` : 'عمومی'}</span>
      </div>

      {user.note && <p className={a.muted}>یادداشت: {user.note}</p>}

      {open && (
        <form onSubmit={onSave} className={a.settingsStack} style={{ gap: 12, paddingTop: 6 }}>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className={a.fieldGrid}>
            <TextField
              label="سقف خرید عضویت اختصاصی (تومان)"
              labelNote="خالی = عمومی"
              ltr
              inputMode="numeric"
              value={joinMin}
              onChange={(e) => setJoinMin(e.target.value)}
            />
            <TextField
              label="حداقل خرید شخصی ماهانه اختصاصی (تومان)"
              labelNote="خالی = عمومی"
              ltr
              inputMode="numeric"
              value={activeMin}
              onChange={(e) => setActiveMin(e.target.value)}
            />
            <TextField
              label="یادداشت ادمین"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <label className={a.checkRow}>
            <input
              type="checkbox"
              checked={useCustomTiers}
              onChange={(e) => setUseCustomTiers(e.target.checked)}
            />
            پلکان فروش و درصد پورسانت اختصاصی برای این فرد
          </label>

          {useCustomTiers && <TiersListEditor tiers={tiers} onChange={setTiers} />}

          <div className={a.actions}>
            <Button type="submit" size="sm" loading={pending} loadingText="در حال ذخیره…">
              ذخیره تغییرات
            </Button>
            {hasAnyOverride && (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onReset}>
                بازگشت به حالت عمومی
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
