'use client';

import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  analyzeBlogSeo,
  slugifyBlog,
  type BlogCategoryDTO,
  type BlogPostDetailDTO,
  type BlogPostStatus,
} from '@/lib/blog/seo';
import { toFaDigits } from '@/lib/format/number';
import { Alert, Button } from '@/ui';
import { RichTextEditor } from './RichTextEditor';
import { SeoScorePanel } from './SeoScorePanel';
import s from './admin-blog.module.css';

function toLocalDatetimeValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PostEditor({
  post,
  categories,
  onCancel,
  onSaved,
}: {
  post: BlogPostDetailDTO | null;
  categories: BlogCategoryDTO[];
  onCancel: () => void;
  onSaved: (saved: BlogPostDetailDTO) => void;
}) {
  const isEdit = Boolean(post);
  const coverFileRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState(post?.title ?? '');
  const [slug, setSlug] = useState(post?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(post?.slug));
  const [categoryId, setCategoryId] = useState(post?.categoryId ?? (categories[0]?.id ?? ''));
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? '');
  const [contentHtml, setContentHtml] = useState(post?.contentHtml ?? '');

  const [coverImageUrl, setCoverImageUrl] = useState(post?.coverImageUrl ?? '');
  const [coverImageAlt, setCoverImageAlt] = useState(post?.coverImageAlt ?? '');
  const [uploadingCover, setUploadingCover] = useState(false);

  const [metaTitle, setMetaTitle] = useState(post?.metaTitle ?? '');
  const [metaDescription, setMetaDescription] = useState(post?.metaDescription ?? '');
  const [focusKeyword, setFocusKeyword] = useState(post?.focusKeyword ?? '');
  const [tags, setTags] = useState<string[]>(post?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');

  const [readingTimeMinutes, setReadingTimeMinutes] = useState<string>(
    post?.readingTimeMinutes ? String(post.readingTimeMinutes) : '',
  );
  const [authorName, setAuthorName] = useState(post?.authorName ?? 'تحریریه آوینا');
  const [status, setStatus] = useState<BlogPostStatus>(post?.status ?? 'draft');
  const [scheduledAt, setScheduledAt] = useState<string>(toLocalDatetimeValue(post?.publishedAt ?? null));

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live SEO score calculation on every edit
  const seo = useMemo(
    () =>
      analyzeBlogSeo({
        title,
        slug: slug || slugifyBlog(title),
        metaTitle,
        metaDescription,
        focusKeyword,
        excerpt,
        contentHtml,
        coverImageUrl,
        coverImageAlt,
        tags,
      }),
    [title, slug, metaTitle, metaDescription, focusKeyword, excerpt, contentHtml, coverImageUrl, coverImageAlt, tags],
  );

  const addTag = (raw: string) => {
    const clean = raw.trim().replace(/^[#،,]+|[،,]+$/g, '');
    if (!clean) return;
    if (!tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setTags((prev) => [...prev, clean]);
    }
    setTagDraft('');
  };

  const onTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '،') {
      e.preventDefault();
      addTag(tagDraft);
    } else if (e.key === 'Backspace' && !tagDraft && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const uploadCover = async (file: File) => {
    setUploadingCover(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/blog/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.message || 'آپلود تصویر شاخص ناموفق بود.');
        return;
      }
      setCoverImageUrl(data.url);
      if (!coverImageAlt.trim() && title.trim()) setCoverImageAlt(title.trim());
    } catch {
      setErr('خطا در آپلود تصویر شاخص.');
    } finally {
      setUploadingCover(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setErr(null);

    try {
      const finalTags = tagDraft.trim() ? [...tags, tagDraft.trim()] : tags;
      const publishedAtIso =
        status === 'scheduled' && scheduledAt
          ? new Date(scheduledAt).toISOString()
          : status === 'published'
            ? (post?.publishedAt ?? new Date().toISOString())
            : null;

      const payload = {
        categoryId: categoryId || null,
        title,
        slug: slug || slugifyBlog(title),
        excerpt,
        contentHtml,
        coverImageUrl: coverImageUrl || null,
        coverImageAlt: coverImageAlt || null,
        metaTitle,
        metaDescription,
        focusKeyword,
        tags: finalTags,
        readingTimeMinutes: readingTimeMinutes ? Number(readingTimeMinutes) : seo.suggestedReadingMinutes,
        authorName,
        status,
        publishedAt: publishedAtIso,
      };

      const url = isEdit && post ? `/api/admin/blog/posts/${post.id}` : '/api/admin/blog/posts';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.message || 'ذخیره مقاله ناموفق بود.');
        return;
      }
      onSaved(data.post);
    } catch {
      setErr('ارتباط با سرور برقرار نشد.');
    } finally {
      setSaving(false);
    }
  };

  const mtLen = (metaTitle || title).trim().length;
  const mdLen = metaDescription.trim().length;

  return (
    <form onSubmit={submit} className={s.shell} data-blog-post-editor>
      <div className={s.topBar}>
        <div>
          <h2 className={s.topTitle}>{isEdit ? 'ویرایش مقاله وبلاگ' : 'نگارش مقاله جدید'}</h2>
          <p className={s.topSub}>
            تمامی فیلدهای سئو، زمان‌بندی انتشار و ویرایشگر پیشرفته متن در یک صفحه — امتیاز سئو به‌صورت لحظه‌ای محاسبه می‌شود.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            بازگشت به فهرست
          </Button>
          <Button type="submit" size="sm" loading={saving} loadingText="در حال ذخیره..." data-blog-save-btn>
            {status === 'published'
              ? 'انتشار و ذخیره مقاله'
              : status === 'scheduled'
                ? 'ثبت زمان‌بندی انتشار'
                : 'ذخیره پیش‌نویس'}
          </Button>
        </div>
      </div>

      {err && <Alert tone="danger">{err}</Alert>}

      <div className={s.editorGrid}>
        {/* Main Column: Title, Content (Word-like), Excerpt, SEO Fields */}
        <div className={s.editorCol}>
          <div className={s.cardBox}>
            <div className={s.field}>
              <div className={s.fieldLabelRow}>
                <label htmlFor="blog-title">عنوان مقاله (H1)</label>
              </div>
              <input
                id="blog-title"
                className={s.input}
                placeholder="مثلاً: راهنمای کامل روتین پوست چرب و مستعد جوش"
                value={title}
                onChange={(e) => {
                  const v = e.target.value;
                  setTitle(v);
                  if (!slugTouched) setSlug(slugifyBlog(v));
                }}
                required
                data-blog-title-input
              />
            </div>

            <div className={s.fieldGrid}>
              <div className={s.field}>
                <div className={s.fieldLabelRow}>
                  <label htmlFor="blog-slug">آدرس مقاله (Slug)</label>
                </div>
                <input
                  id="blog-slug"
                  className={`${s.input} ${s.ltr}`}
                  placeholder="oily-skin-routine"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value);
                  }}
                  required
                  data-blog-slug-input
                />
              </div>

              <div className={s.field}>
                <div className={s.fieldLabelRow}>
                  <label htmlFor="blog-cat">دسته‌بندی مقاله</label>
                </div>
                <select
                  id="blog-cat"
                  className={s.select}
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  data-blog-category-select
                >
                  <option value="">بدون دسته‌بندی</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {!c.isActive ? '(غیرفعال)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className={s.field}>
              <div className={s.fieldLabelRow}>
                <label htmlFor="blog-excerpt">خلاصه مقاله (نمایش در کارت‌های وبلاگ و صفحه اصلی)</label>
              </div>
              <textarea
                id="blog-excerpt"
                rows={2}
                className={s.textarea}
                placeholder="توضیح کوتاه و جذاب ۲ تا ۳ خطی درباره محتوای مقاله..."
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                data-blog-excerpt-input
              />
            </div>

            <div className={s.field}>
              <div className={s.fieldLabelRow}>
                <span>متن کامل مقاله (ویرایشگر حرفه‌ای شبیه Word)</span>
                <span className={s.muted}>
                  {toFaDigits(seo.wordCount)} کلمه · زمان مطالعه پیشنهادی: {toFaDigits(seo.suggestedReadingMinutes)} دقیقه
                </span>
              </div>
              <RichTextEditor value={contentHtml} onChange={setContentHtml} />
            </div>
          </div>

          {/* SEO & Meta Box */}
          <div className={s.cardBox}>
            <div>
              <h3 className={s.sectionTitle}>تنظیمات سئو، متا و برچسب‌ها</h3>
              <p className={s.muted}>کلمه کلیدی اصلی، تایتل متا، متا دیسکریپشن و برچسب‌های مقاله را برای رتبه‌بندی بهتر تنظیم کنید.</p>
            </div>

            <div className={s.fieldGrid}>
              <div className={s.field}>
                <div className={s.fieldLabelRow}>
                  <label htmlFor="blog-kw">کلمه کلیدی اصلی (Focus Keyword)</label>
                </div>
                <input
                  id="blog-kw"
                  className={s.input}
                  placeholder="مثلاً: روتین مراقبت از پوست چرب"
                  value={focusKeyword}
                  onChange={(e) => setFocusKeyword(e.target.value)}
                  data-blog-keyword-input
                />
              </div>

              <div className={s.field}>
                <div className={s.fieldLabelRow}>
                  <label htmlFor="blog-meta-title">عنوان متا (Meta Title)</label>
                  <span
                    className={`${s.charCount} ${
                      mtLen >= 35 && mtLen <= 65 ? s.charGood : mtLen >= 20 && mtLen <= 75 ? s.charWarn : s.charBad
                    }`}
                  >
                    {toFaDigits(mtLen)} / ۶۵
                  </span>
                </div>
                <input
                  id="blog-meta-title"
                  className={s.input}
                  placeholder="عنوان نمایشی در نتایج گوگل (۳۵ تا ۶۵ کاراکتر)"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  data-blog-metatitle-input
                />
              </div>
            </div>

            <div className={s.field}>
              <div className={s.fieldLabelRow}>
                <label htmlFor="blog-meta-desc">متا دیسکریپشن (Meta Description)</label>
                <span
                  className={`${s.charCount} ${
                    mdLen >= 115 && mdLen <= 165 ? s.charGood : mdLen >= 70 && mdLen <= 180 ? s.charWarn : s.charBad
                  }`}
                >
                  {toFaDigits(mdLen)} / ۱۶۵
                </span>
              </div>
              <textarea
                id="blog-meta-desc"
                rows={3}
                className={s.textarea}
                placeholder="توضیح جذاب بین ۱۲۰ تا ۱۶۰ کاراکتر شامل کلمه کلیدی اصلی برای افزایش نرخ کلیک در گوگل..."
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                data-blog-metadesc-input
              />
            </div>

            <div className={s.field}>
              <div className={s.fieldLabelRow}>
                <label htmlFor="blog-tags">برچسب‌ها (Enter یا کاما برای افزودن)</label>
              </div>
              <div className={s.tagsWrap}>
                {tags.map((t) => (
                  <span key={t} className={s.tagChip}>
                    #{t}
                    <button
                      type="button"
                      className={s.tagRemove}
                      onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                      aria-label={`حذف برچسب ${t}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  id="blog-tags"
                  className={s.tagInput}
                  placeholder="تایپ برچسب و فشردن Enter..."
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={onTagKeyDown}
                  onBlur={() => {
                    if (tagDraft.trim()) addTag(tagDraft);
                  }}
                  data-blog-tag-input
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Column: Publish & Schedule, Author & Reading Time, Cover Image, Live SEO Score */}
        <div className={s.editorCol}>
          <div className={s.cardBox}>
            <h3 className={s.sectionTitle}>انتشار و زمان‌بندی</h3>

            <div className={s.field}>
              <div className={s.fieldLabelRow}>
                <label htmlFor="blog-status">وضعیت انتشار</label>
              </div>
              <select
                id="blog-status"
                className={s.select}
                value={status}
                onChange={(e) => setStatus(e.target.value as BlogPostStatus)}
                data-blog-status-select
              >
                <option value="draft">پیش‌نویس (عدم نمایش عمومی)</option>
                <option value="published">انتشار فوری در لحظه</option>
                <option value="scheduled">زمان‌بندی برای تاریخ آینده</option>
              </select>
            </div>

            {status === 'scheduled' && (
              <div className={s.field}>
                <div className={s.fieldLabelRow}>
                  <label htmlFor="blog-schedule">تاریخ و ساعت انتشار</label>
                </div>
                <input
                  id="blog-schedule"
                  type="datetime-local"
                  className={`${s.input} ${s.ltr}`}
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required
                  data-blog-schedule-input
                />
                <span className={s.muted}>مقاله در تاریخ و ساعت انتخابی به‌صورت خودکار منتشر می‌شود.</span>
              </div>
            )}

            <div className={s.field}>
              <div className={s.fieldLabelRow}>
                <label htmlFor="blog-author">نام نویسنده</label>
              </div>
              <input
                id="blog-author"
                className={s.input}
                placeholder="مثلاً: دکتر سارا نادری"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                required
                data-blog-author-input
              />
            </div>

            <div className={s.field}>
              <div className={s.fieldLabelRow}>
                <label htmlFor="blog-reading">زمان مطالعه (دقیقه)</label>
                <button
                  type="button"
                  className={s.miniBtn}
                  style={{ height: 24, fontSize: 11 }}
                  onClick={() => setReadingTimeMinutes(String(seo.suggestedReadingMinutes))}
                >
                  خودکار ({toFaDigits(seo.suggestedReadingMinutes)})
                </button>
              </div>
              <input
                id="blog-reading"
                type="number"
                min={1}
                max={120}
                className={`${s.input} ${s.ltr}`}
                placeholder={String(seo.suggestedReadingMinutes)}
                value={readingTimeMinutes}
                onChange={(e) => setReadingTimeMinutes(e.target.value)}
                data-blog-reading-input
              />
            </div>
          </div>

          {/* Cover Image Card */}
          <div className={s.cardBox}>
            <h3 className={s.sectionTitle}>تصویر شاخص مقاله</h3>
            <p className={s.muted}>
              هر تصویری با هر ابعادی بارگذاری شود، در کارت‌ها و صفحه مقاله با نسبت استاندارد ۱۶:۱۰ نمایش داده می‌شود.
            </p>

            <div className={s.coverPreview}>
              {coverImageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={coverImageUrl} alt={coverImageAlt || title || 'پیش‌نمایش تصویر شاخص'} />
              ) : (
                <span>پیش‌نمایش تصویر شاخص (۱۶:۱۰)</span>
              )}
            </div>

            <input
              ref={coverFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void uploadCover(f);
              }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={uploadingCover}
                loadingText="در حال آپلود..."
                onClick={() => coverFileRef.current?.click()}
              >
                آپلود تصویر شاخص
              </Button>
              {coverImageUrl && (
                <button
                  type="button"
                  className={`${s.miniBtn} ${s.miniBtnDanger}`}
                  onClick={() => setCoverImageUrl('')}
                >
                  حذف تصویر
                </button>
              )}
            </div>

            <div className={s.field}>
              <label style={{ fontSize: 12, fontWeight: 700 }} htmlFor="blog-cover-url">
                آدرس تصویر شاخص
              </label>
              <input
                id="blog-cover-url"
                className={`${s.input} ${s.ltr}`}
                placeholder="/images/blog/... یا https://..."
                value={coverImageUrl}
                onChange={(e) => setCoverImageUrl(e.target.value)}
                data-blog-cover-url
              />
            </div>

            <div className={s.field}>
              <label style={{ fontSize: 12, fontWeight: 700 }} htmlFor="blog-cover-alt">
                متن جایگزین تصویر (Alt)
              </label>
              <input
                id="blog-cover-alt"
                className={s.input}
                placeholder="توضیح دقیق تصویر برای سئو"
                value={coverImageAlt}
                onChange={(e) => setCoverImageAlt(e.target.value)}
                data-blog-cover-alt
              />
            </div>
          </div>

          {/* Live SEO Score Panel */}
          <SeoScorePanel
            analysis={seo}
            previewTitle={metaTitle || title}
            previewSlug={slug || slugifyBlog(title)}
            previewDescription={metaDescription || excerpt}
          />
        </div>
      </div>
    </form>
  );
}
