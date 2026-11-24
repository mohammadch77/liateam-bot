'use client';

import { useState, type FormEvent } from 'react';
import type { ChatCannedResponseDTO } from '@/lib/live-chat/types';
import { Alert, Button } from '@/ui';
import s from './live-chat-panel.module.css';

export function CannedTab({
  items,
  onChange,
}: {
  items: ChatCannedResponseDTO[];
  onChange: (next: ChatCannedResponseDTO[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setShortcut('');
    setTitle('');
    setBody('');
  };

  const startEdit = (item: ChatCannedResponseDTO) => {
    setEditingId(item.id);
    setShortcut(item.shortcut);
    setTitle(item.title);
    setBody(item.body);
    setMsg(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const url = editingId ? `/api/admin/live-chat/canned/${editingId}` : '/api/admin/live-chat/canned';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortcut, title, body }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMsg({ tone: 'danger', text: data.message || 'خطا در ذخیره پاسخ آماده.' });
        return;
      }
      if (editingId) {
        onChange(items.map((i) => (i.id === editingId ? data.item : i)));
        setMsg({ tone: 'success', text: 'پاسخ آماده ویرایش شد.' });
      } else {
        onChange([...items, data.item].sort((a, b) => a.shortcut.localeCompare(b.shortcut, 'fa')));
        setMsg({ tone: 'success', text: 'پاسخ آماده جدید اضافه شد.' });
      }
      resetForm();
    } catch {
      setMsg({ tone: 'danger', text: 'ارتباط با سرور برقرار نشد.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setMsg(null);
    const res = await fetch(`/api/admin/live-chat/canned/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setMsg({ tone: 'danger', text: data.message || 'حذف انجام نشد.' });
      return;
    }
    onChange(items.filter((i) => i.id !== id));
    if (editingId === id) resetForm();
  };

  return (
    <div className={s.shell}>
      <form onSubmit={submit} className={s.cardBox} data-canned-form>
        <div>
          <h2 className={s.sectionTitle}>{editingId ? 'ویرایش پاسخ آماده' : 'افزودن پاسخ آماده جدید'}</h2>
          <p className={s.muted}>
            در کادر نوشتن پیام کافی است علامت <code>/</code> را تایپ کنید تا پاسخ‌های آماده برای درج سریع نمایش داده شوند.
          </p>
        </div>

        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

        <div className={s.formGrid}>
          <div className={s.fieldCol}>
            <label htmlFor="canned-shortcut">میانبر (بدون اسلش)</label>
            <input
              id="canned-shortcut"
              className={s.input}
              placeholder="مثلاً: پیگیری"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              required
            />
          </div>
          <div className={s.fieldCol}>
            <label htmlFor="canned-title">عنوان کوتاه</label>
            <input
              id="canned-title"
              className={s.input}
              placeholder="مثلاً: راهنمای پیگیری سفارش"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
        </div>

        <div className={s.fieldCol}>
          <label htmlFor="canned-body">متن کامل پاسخ</label>
          <textarea
            id="canned-body"
            rows={3}
            className={s.textareaField}
            placeholder="متن پاسخی که برای مشتری ارسال می‌شود..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" size="sm" loading={busy} loadingText="در حال ثبت...">
            {editingId ? 'ذخیره تغییرات' : 'افزودن پاسخ آماده'}
          </Button>
          {editingId && (
            <Button type="button" size="sm" variant="outline" onClick={resetForm}>
              انصراف
            </Button>
          )}
        </div>
      </form>

      <div className={s.cardBox}>
        <h2 className={s.sectionTitle}>فهرست پاسخ‌های آماده ({items.length})</h2>
        {items.length === 0 ? (
          <p className={s.muted}>هنوز پاسخ آماده‌ای ثبت نشده است.</p>
        ) : (
          <div className={s.cannedGrid}>
            {items.map((item) => (
              <div key={item.id} className={s.cannedCard}>
                <div className={s.cannedCardHead}>
                  <span className={s.cannedShortcut}>/{item.shortcut}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className={s.miniBtn} onClick={() => startEdit(item)}>
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className={`${s.miniBtn} ${s.miniBtnDanger}`}
                      onClick={() => void remove(item.id)}
                    >
                      حذف
                    </button>
                  </div>
                </div>
                <strong style={{ fontSize: 13.5 }}>{item.title}</strong>
                <p className={s.muted} style={{ whiteSpace: 'pre-wrap' }}>
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
