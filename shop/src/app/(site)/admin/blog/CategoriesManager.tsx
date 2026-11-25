'use client';

import { useState, type FormEvent } from 'react';
import { slugifyBlog, type BlogCategoryDTO } from '@/lib/blog/seo';
import { toFaDigits } from '@/lib/format/number';
import { Alert, Button } from '@/ui';
import s from './admin-blog.module.css';

export function CategoriesManager({
  categories,
  onChange,
}: {
  categories: BlogCategoryDTO[];
  onChange: (next: BlogCategoryDTO[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('1');
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const reset = () => {
    setEditingId(null);
    setName('');
    setSlug('');
    setSlugTouched(false);
    setDescription('');
    setSortOrder(String(categories.length + 1));
    setIsActive(true);
  };

  const startEdit = (cat: BlogCategoryDTO) => {
    setEditingId(cat.id);
    setName(cat.name);
    setSlug(cat.slug);
    setSlugTouched(true);
    setDescription(cat.description ?? '');
    setSortOrder(String(cat.sortOrder));
    setIsActive(cat.isActive);
    setMsg(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const url = editingId ? `/api/admin/blog/categories/${editingId}` : '/api/admin/blog/categories';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          slug: slug || slugifyBlog(name),
          description,
          sortOrder: Number(sortOrder) || 1,
          isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMsg({ tone: 'danger', text: data.message || 'ذخیره دسته‌بندی ناموفق بود.' });
        return;
      }
      if (editingId) {
        onChange(
          categories
            .map((c) => (c.id === editingId ? { ...data.category, postCount: c.postCount } : c))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        );
        setMsg({ tone: 'success', text: 'دسته‌بندی با موفقیت ویرایش شد.' });
      } else {
        onChange([...categories, { ...data.category, postCount: 0 }].sort((a, b) => a.sortOrder - b.sortOrder));
        setMsg({ tone: 'success', text: 'دسته‌بندی جدید اضافه شد.' });
      }
      reset();
    } catch {
      setMsg({ tone: 'danger', text: 'ارتباط با سرور برقرار نشد.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setMsg(null);
    const res = await fetch(`/api/admin/blog/categories/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setMsg({ tone: 'danger', text: data.message || 'حذف انجام نشد.' });
      return;
    }
    onChange(categories.filter((c) => c.id !== id));
    if (editingId === id) reset();
  };

  return (
    <div className={s.shell} data-blog-categories-manager>
      <form onSubmit={submit} className={s.cardBox}>
        <div>
          <h2 className={s.sectionTitle}>{editingId ? 'ویرایش دسته‌بندی وبلاگ' : 'افزودن دسته‌بندی جدید'}</h2>
          <p className={s.muted}>دسته‌بندی‌های وبلاگ برای فیلتر مقالات و ساختار سئوی مجله استفاده می‌شوند.</p>
        </div>

        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

        <div className={s.fieldGrid}>
          <div className={s.field}>
            <label style={{ fontSize: 12.5, fontWeight: 700 }} htmlFor="bcat-name">
              نام دسته‌بندی
            </label>
            <input
              id="bcat-name"
              className={s.input}
              placeholder="مثلاً: عطر و ادکلن"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugifyBlog(e.target.value));
              }}
              required
            />
          </div>

          <div className={s.field}>
            <label style={{ fontSize: 12.5, fontWeight: 700 }} htmlFor="bcat-slug">
              نامک (URL Slug)
            </label>
            <input
              id="bcat-slug"
              className={`${s.input} ${s.ltr}`}
              placeholder="perfume-guide"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              required
            />
          </div>

          <div className={s.field}>
            <label style={{ fontSize: 12.5, fontWeight: 700 }} htmlFor="bcat-order">
              ترتیب نمایش
            </label>
            <input
              id="bcat-order"
              type="number"
              min={1}
              max={999}
              className={`${s.input} ${s.ltr}`}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
        </div>

        <div className={s.field}>
          <label style={{ fontSize: 12.5, fontWeight: 700 }} htmlFor="bcat-desc">
            توضیح کوتاه دسته‌بندی
          </label>
          <input
            id="bcat-desc"
            className={s.input}
            placeholder="توضیح مختصر موضوع مقالات این دسته..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          دسته‌بندی فعال و قابل مشاهده در صفحه وبلاگ باشد
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" size="sm" loading={busy} loadingText="در حال ذخیره...">
            {editingId ? 'ذخیره تغییرات دسته‌بندی' : 'افزودن دسته‌بندی'}
          </Button>
          {editingId && (
            <Button type="button" size="sm" variant="outline" onClick={reset}>
              انصراف
            </Button>
          )}
        </div>
      </form>

      <div className={s.cardBox}>
        <h2 className={s.sectionTitle}>دسته‌بندی‌های فعلی ({toFaDigits(categories.length)})</h2>
        <div className={s.catGrid}>
          {categories.map((cat) => (
            <div key={cat.id} className={s.catCard}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 14.5 }}>{cat.name}</strong>
                <span className={`${s.pill} ${cat.isActive ? s.pillGreen : s.pillMuted}`}>
                  {cat.isActive ? 'فعال' : 'غیرفعال'}
                </span>
              </div>
              <div className={s.muted} dir="ltr" style={{ textAlign: 'left' }}>
                /blog?category={cat.slug}
              </div>
              {cat.description && <p className={s.muted}>{cat.description}</p>}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 6 }}>
                <span className={s.muted}>
                  {toFaDigits(cat.postCount ?? 0)} مقاله · ترتیب {toFaDigits(cat.sortOrder)}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className={s.miniBtn} onClick={() => startEdit(cat)}>
                    ویرایش
                  </button>
                  <button
                    type="button"
                    className={`${s.miniBtn} ${s.miniBtnDanger}`}
                    onClick={() => void remove(cat.id)}
                  >
                    حذف
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
