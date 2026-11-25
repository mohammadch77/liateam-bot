'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type {
  BlogCategoryDTO,
  BlogPostDetailDTO,
  BlogPostStatus,
  BlogPostSummaryDTO,
} from '@/lib/blog/seo';
import { toFaDigits } from '@/lib/format/number';
import { Alert, Button, Icon } from '@/ui';
import { CategoriesManager } from './CategoriesManager';
import { PostEditor } from './PostEditor';
import s from './admin-blog.module.css';

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return dateFa.format(new Date(iso));
  } catch {
    return '—';
  }
}

export function BlogAdminClient({
  initialCategories,
  initialPosts,
}: {
  initialCategories: BlogCategoryDTO[];
  initialPosts: BlogPostSummaryDTO[];
}) {
  const [tab, setTab] = useState<'posts' | 'categories'>('posts');
  const [categories, setCategories] = useState<BlogCategoryDTO[]>(initialCategories);
  const [posts, setPosts] = useState<BlogPostSummaryDTO[]>(initialPosts);

  const [statusFilter, setStatusFilter] = useState<BlogPostStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  // Editor state: null = list view, 'new' = create mode, BlogPostDetailDTO = edit mode
  const [editingPost, setEditingPost] = useState<'new' | BlogPostDetailDTO | null>(null);
  const [loadingPostId, setLoadingPostId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter((p) => {
      if (statusFilter !== 'all' && p.effectiveStatus !== statusFilter) return false;
      if (!q) return true;
      return `${p.title} ${p.slug} ${p.focusKeyword} ${p.authorName} ${p.categoryName ?? ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [posts, statusFilter, search]);

  const counts = useMemo(() => {
    let published = 0;
    let scheduled = 0;
    let draft = 0;
    for (const p of posts) {
      if (p.effectiveStatus === 'published') published += 1;
      else if (p.effectiveStatus === 'scheduled') scheduled += 1;
      else draft += 1;
    }
    return { published, scheduled, draft };
  }, [posts]);

  const openEdit = async (id: string) => {
    setLoadingPostId(id);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/blog/posts/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setBanner({ tone: 'danger', text: data.message || 'خطا در بارگذاری مقاله.' });
        return;
      }
      setEditingPost(data.post);
    } catch {
      setBanner({ tone: 'danger', text: 'ارتباط با سرور برقرار نشد.' });
    } finally {
      setLoadingPostId(null);
    }
  };

  const deletePost = async (id: string) => {
    setBanner(null);
    const res = await fetch(`/api/admin/blog/posts/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setBanner({ tone: 'danger', text: data.message || 'حذف مقاله ناموفق بود.' });
      return;
    }
    setPosts((prev) => prev.filter((p) => p.id !== id));
    setBanner({ tone: 'success', text: 'مقاله با موفقیت حذف شد.' });
  };

  if (editingPost !== null) {
    return (
      <PostEditor
        post={editingPost === 'new' ? null : editingPost}
        categories={categories}
        onCancel={() => setEditingPost(null)}
        onSaved={(saved) => {
          setPosts((prev) => {
            const exists = prev.some((p) => p.id === saved.id);
            const next = exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev];
            return next;
          });
          setEditingPost(null);
          setBanner({ tone: 'success', text: `مقاله «${saved.title}» با امتیاز سئو ${toFaDigits(saved.seoScore)} ذخیره شد.` });
        }}
      />
    );
  }

  return (
    <div className={s.shell} data-admin-blog>
      <div className={s.topBar}>
        <div>
          <h1 className={s.topTitle}>
            <Icon name="category" size={22} />
            مدیریت وبلاگ و مجله زیبایی
          </h1>
          <p className={s.topSub}>
            تعریف و ویرایش دسته‌بندی‌ها، نگارش مقالات با ویرایشگر حرفه‌ای، زمان‌بندی انتشار و سنجش زنده سئو
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/blog" target="_blank" className={s.miniBtn}>
            مشاهده صفحه وبلاگ ↗
          </Link>
          <Button
            type="button"
            size="sm"
            icon="add"
            onClick={() => {
              setBanner(null);
              setEditingPost('new');
            }}
            data-blog-new-btn
          >
            نوشتن مقاله جدید
          </Button>
        </div>
      </div>

      <div className={s.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'posts'}
          className={`${s.tabBtn} ${tab === 'posts' ? s.tabBtnActive : ''}`}
          onClick={() => setTab('posts')}
          data-blog-admin-tab="posts"
        >
          مقالات ({toFaDigits(posts.length)})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'categories'}
          className={`${s.tabBtn} ${tab === 'categories' ? s.tabBtnActive : ''}`}
          onClick={() => setTab('categories')}
          data-blog-admin-tab="categories"
        >
          دسته‌بندی‌های وبلاگ ({toFaDigits(categories.length)})
        </button>
      </div>

      {banner && <Alert tone={banner.tone}>{banner.text}</Alert>}

      {tab === 'posts' ? (
        <div className={s.cardBox}>
          <div className={s.filterBar}>
            <div className={s.chips}>
              {([
                ['all', `همه (${toFaDigits(posts.length)})`],
                ['published', `منتشرشده (${toFaDigits(counts.published)})`],
                ['scheduled', `زمان‌بندی‌شده (${toFaDigits(counts.scheduled)})`],
                ['draft', `پیش‌نویس (${toFaDigits(counts.draft)})`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`${s.chip} ${statusFilter === key ? s.chipActive : ''}`}
                  onClick={() => setStatusFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <input
              type="search"
              className={s.input}
              style={{ width: 'min(290px, 100%)' }}
              placeholder="جستجو در عنوان، کلیدواژه یا نویسنده..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {filteredPosts.length === 0 ? (
            <p className={s.muted} style={{ textAlign: 'center', padding: '24px 0' }}>
              مقاله‌ای در این بخش یافت نشد.
            </p>
          ) : (
            <div className={s.postList}>
              {filteredPosts.map((p) => {
                const statusBadge =
                  p.effectiveStatus === 'published'
                    ? { cls: s.pillGreen, text: 'منتشرشده' }
                    : p.effectiveStatus === 'scheduled'
                      ? { cls: s.pillAmber, text: 'زمان‌بندی‌شده' }
                      : { cls: s.pillMuted, text: 'پیش‌نویس' };
                const seoBadge =
                  p.seoScore >= 80
                    ? s.pillGreen
                    : p.seoScore >= 55
                      ? s.pillAmber
                      : s.pillRed;

                return (
                  <div key={p.id} className={s.postRow} data-blog-admin-post={p.slug}>
                    <div className={s.postThumb}>
                      {p.coverImageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={p.coverImageUrl} alt={p.title} />
                      ) : (
                        <Icon name="spa" size={24} />
                      )}
                    </div>

                    <div className={s.postInfo}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <span className={s.postTitle}>{p.title}</span>
                        <span className={`${s.pill} ${statusBadge.cls}`}>{statusBadge.text}</span>
                        <span className={`${s.pill} ${seoBadge}`}>سئو: {toFaDigits(p.seoScore)}/۱۰۰</span>
                      </div>
                      <div className={s.postMeta}>
                        {p.categoryName && <span>دسته: {p.categoryName}</span>}
                        <span>نویسنده: {p.authorName}</span>
                        <span>{toFaDigits(p.readingTimeMinutes)} دقیقه مطالعه</span>
                        <span>تاریخ انتشار: {fmtDate(p.publishedAt)}</span>
                      </div>
                    </div>

                    <div className={s.postActions}>
                      {p.effectiveStatus === 'published' && (
                        <Link href={`/blog/${p.slug}`} target="_blank" className={s.miniBtn}>
                          مشاهده
                        </Link>
                      )}
                      <button
                        type="button"
                        className={s.miniBtn}
                        disabled={loadingPostId === p.id}
                        onClick={() => void openEdit(p.id)}
                      >
                        {loadingPostId === p.id ? 'بازکردن...' : 'ویرایش'}
                      </button>
                      <button
                        type="button"
                        className={`${s.miniBtn} ${s.miniBtnDanger}`}
                        onClick={() => void deletePost(p.id)}
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <CategoriesManager categories={categories} onChange={setCategories} />
      )}
    </div>
  );
}
