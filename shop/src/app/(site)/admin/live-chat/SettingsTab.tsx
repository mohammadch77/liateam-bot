'use client';

import { useState, type FormEvent } from 'react';
import {
  PRECHAT_FIELD_LABEL,
  PRECHAT_FIELD_PLACEHOLDER,
  type ChatPreChatField,
  type ChatWidgetSettings,
} from '@/lib/live-chat/types';
import { Alert, Button } from '@/ui';
import s from './live-chat-panel.module.css';

export function SettingsTab({
  initialSettings,
  initialPreChatFields,
  isAdmin,
  onSaved,
}: {
  initialSettings: ChatWidgetSettings;
  initialPreChatFields: ChatPreChatField[];
  isAdmin: boolean;
  onSaved: (settings: ChatWidgetSettings, fields: ChatPreChatField[]) => void;
}) {
  const [settings, setSettings] = useState<ChatWidgetSettings>(initialSettings);
  const [fields, setFields] = useState<ChatPreChatField[]>(
    [...initialPreChatFields].sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const moveField = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= fields.length) return;
    const copy = [...fields];
    const [item] = copy.splice(idx, 1);
    if (!item) return;
    copy.splice(nextIdx, 0, item);
    setFields(copy.map((f, i) => ({ ...f, sortOrder: i + 1 })));
  };

  const patchField = (idx: number, patch: Partial<ChatPreChatField>) => {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== idx) return f;
        const next = { ...f, ...patch };
        if (!next.enabled) next.required = false;
        return next;
      }),
    );
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/live-chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings, preChatFields: fields }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({ tone: 'danger', text: data.message || 'خطا در ذخیره تنظیمات.' });
        return;
      }
      setSettings(data.settings);
      setFields(data.preChatFields);
      onSaved(data.settings, data.preChatFields);
      setFeedback({ tone: 'success', text: 'تنظیمات پشتیبانی آنلاین و فرم پیش از چت با موفقیت ذخیره شد.' });
    } catch {
      setFeedback({ tone: 'danger', text: 'ارتباط با سرور برقرار نشد.' });
    } finally {
      setSaving(false);
    }
  };

  const activePreviewFields = fields.filter((f) => f.enabled);

  return (
    <form onSubmit={onSubmit} className={s.shell} data-live-chat-settings-form>
      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      <div className={s.cardBox}>
        <div>
          <h2 className={s.sectionTitle}>تنظیمات ابزارک گفتگوی آنلاین</h2>
          <p className={s.muted}>نمایش، موقعیت و پیام‌های خوش‌آمدگویی ابزارک پشتیبانی در صفحات فروشگاه را مدیریت کنید.</p>
        </div>

        <div className={s.switchRow}>
          <div>
            <strong>فعال بودن ابزارک پشتیبانی آنلاین در فروشگاه</strong>
            <div className={s.muted}>در صورت غیرفعال کردن، دکمه چت برای مشتریان نمایش داده نمی‌شود.</div>
          </div>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={!isAdmin}
            onChange={(e) => setSettings((p) => ({ ...p, enabled: e.target.checked }))}
          />
        </div>

        <div className={s.switchRow}>
          <div>
            <strong>پخش صدای اعلان پیام جدید</strong>
            <div className={s.muted}>اعلان صوتی ملایم هنگام دریافت پیام جدید در ابزارک مشتری.</div>
          </div>
          <input
            type="checkbox"
            checked={settings.soundEnabled}
            disabled={!isAdmin}
            onChange={(e) => setSettings((p) => ({ ...p, soundEnabled: e.target.checked }))}
          />
        </div>

        <div className={s.formGrid}>
          <div className={s.fieldCol}>
            <label htmlFor="lc-widget-title">عنوان ابزارک</label>
            <input
              id="lc-widget-title"
              className={s.input}
              value={settings.widgetTitle}
              disabled={!isAdmin}
              onChange={(e) => setSettings((p) => ({ ...p, widgetTitle: e.target.value }))}
              required
            />
          </div>

          <div className={s.fieldCol}>
            <label htmlFor="lc-widget-pos">موقعیت دکمه چت</label>
            <select
              id="lc-widget-pos"
              className={s.selectField}
              value={settings.position}
              disabled={!isAdmin}
              onChange={(e) =>
                setSettings((p) => ({
                  ...p,
                  position: e.target.value === 'bottom_right' ? 'bottom_right' : 'bottom_left',
                }))
              }
            >
              <option value="bottom_left">پایین سمت چپ (پیشنهادی برای سایت فارسی)</option>
              <option value="bottom_right">پایین سمت راست</option>
            </select>
          </div>
        </div>

        <div className={s.formGrid}>
          <div className={s.fieldCol}>
            <label htmlFor="lc-welcome-msg">پیام خوش‌آمدگویی (وقتی پشتیبان آنلاین است)</label>
            <textarea
              id="lc-welcome-msg"
              rows={3}
              className={s.textareaField}
              value={settings.welcomeMessage}
              disabled={!isAdmin}
              onChange={(e) => setSettings((p) => ({ ...p, welcomeMessage: e.target.value }))}
            />
          </div>

          <div className={s.fieldCol}>
            <label htmlFor="lc-offline-msg">پیام حالت آفلاین</label>
            <textarea
              id="lc-offline-msg"
              rows={3}
              className={s.textareaField}
              value={settings.offlineMessage}
              disabled={!isAdmin}
              onChange={(e) => setSettings((p) => ({ ...p, offlineMessage: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className={s.cardBox}>
        <div>
          <h2 className={s.sectionTitle}>فرم پیش از چت (Pre-Chat Form)</h2>
          <p className={s.muted}>
            فقط برای بازدیدکنندگان مهمان که هنوز گفتگوی فعالی ندارند نمایش داده می‌شود. مشتریان واردشده به حساب آوینا
            به‌صورت خودکار شناسایی می‌شوند و فرم برای آن‌ها نمایش داده نمی‌شود.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((field, idx) => (
            <div key={field.key} className={s.preChatRow}>
              <strong>{PRECHAT_FIELD_LABEL[field.key]}</strong>
              <div className={s.preChatControls}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    disabled={!isAdmin}
                    onChange={(e) => patchField(idx, { enabled: e.target.checked })}
                  />
                  فعال
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={field.required}
                    disabled={!isAdmin || !field.enabled}
                    onChange={(e) => patchField(idx, { required: e.target.checked })}
                  />
                  اجباری
                </label>
                <div className={s.orderBtns}>
                  <button
                    type="button"
                    className={s.miniBtn}
                    disabled={!isAdmin || idx === 0}
                    onClick={() => moveField(idx, -1)}
                    aria-label="انتقال به بالا"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={s.miniBtn}
                    disabled={!isAdmin || idx === fields.length - 1}
                    onClick={() => moveField(idx, 1)}
                    aria-label="انتقال به پایین"
                  >
                    ↓
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={s.previewBox}>
          <strong style={{ fontSize: 13 }}>پیش‌نمایش فرم برای بازدیدکننده مهمان:</strong>
          {activePreviewFields.length === 0 ? (
            <span className={s.muted}>هیچ فیلدی فعال نیست؛ بازدیدکننده مستقیماً وارد گفتگو می‌شود.</span>
          ) : (
            <div className={s.formGrid}>
              {activePreviewFields.map((f) => (
                <div key={f.key} className={s.fieldCol}>
                  <label>
                    {PRECHAT_FIELD_LABEL[f.key]} {f.required ? '(اجباری)' : '(اختیاری)'}
                  </label>
                  <input className={s.input} disabled placeholder={PRECHAT_FIELD_PLACEHOLDER[f.key]} />
                </div>
              ))}
            </div>
          )}
        </div>

        {isAdmin && (
          <div>
            <Button type="submit" loading={saving} loadingText="در حال ذخیره...">
              ذخیره تنظیمات پشتیبانی آنلاین
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
