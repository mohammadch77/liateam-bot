import 'server-only';
import { revalidatePath } from 'next/cache';
import {
  analyzeBlogSeo,
  estimateReadingMinutes,
  sanitizeBlogHtml,
  slugifyBlog,
  stripHtmlToText,
  type BlogCategoryDTO,
  type BlogPostDetailDTO,
  type BlogPostStatus,
  type BlogPostSummaryDTO,
} from '@/lib/blog/seo';
import { AppError } from '@/lib/errors';
import { authorize } from '@/server/auth/guards';
import { auditRepository } from '@/server/repositories/audit.repository';
import { blogRepository } from '@/server/repositories/blog.repository';

function cleanShort(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

function cleanTags(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.map((x) => (typeof x === 'string' ? x : ''))
    : typeof raw === 'string'
      ? raw.split(/[،,]+/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const clean = cleanShort(item, 40);
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      out.push(clean);
      if (out.length >= 15) break;
    }
  }
  return out;
}

function cleanCoverUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) return trimmed.slice(0, 600);
  return null;
}

export type BlogPostInput = {
  categoryId?: string | null;
  title?: string;
  slug?: string;
  excerpt?: string;
  contentHtml?: string;
  coverImageUrl?: string | null;
  coverImageAlt?: string | null;
  metaTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  tags?: string[] | string;
  readingTimeMinutes?: number | string;
  authorName?: string;
  status?: BlogPostStatus;
  publishedAt?: string | null;
};

function normalizePostInput(input: BlogPostInput) {
  const title = cleanShort(input.title, 180);
  if (title.length < 3) {
    throw new AppError('INVALID_DATA', { message: 'عنوان مقاله باید حداقل ۳ حرف باشد.' });
  }

  const slugSource = cleanShort(input.slug, 120) || title;
  const slug = slugifyBlog(slugSource);
  if (!slug || slug.length < 2) {
    throw new AppError('INVALID_DATA', { message: 'نامک (آدرس URL) مقاله معتبر نیست.' });
  }

  const contentHtml = sanitizeBlogHtml(typeof input.contentHtml === 'string' ? input.contentHtml : '');
  const plainText = stripHtmlToText(contentHtml);

  const excerptRaw = cleanShort(input.excerpt, 450);
  const excerpt = excerptRaw || (plainText ? plainText.slice(0, 180) : '');

  const metaTitle = cleanShort(input.metaTitle, 120) || title;
  const metaDescription = cleanShort(input.metaDescription, 260) || excerpt.slice(0, 160);
  const focusKeyword = cleanShort(input.focusKeyword, 90);
  const tags = cleanTags(input.tags);
  const coverImageUrl = cleanCoverUrl(input.coverImageUrl);
  const coverImageAlt = cleanShort(input.coverImageAlt, 160) || (coverImageUrl ? title : null);
  const authorName = cleanShort(input.authorName, 80) || 'تحریریه آوینا';
  const categoryId = typeof input.categoryId === 'string' && /^\d+$/.test(input.categoryId.trim()) ? input.categoryId.trim() : null;

  const autoMinutes = estimateReadingMinutes(contentHtml);
  const parsedMin = Number(input.readingTimeMinutes);
  const readingTimeMinutes =
    Number.isFinite(parsedMin) && parsedMin >= 1 && parsedMin <= 120 ? Math.round(parsedMin) : autoMinutes;

  const status: BlogPostStatus =
    input.status === 'published' || input.status === 'scheduled' || input.status === 'draft'
      ? input.status
      : 'draft';

  let publishedAt: Date | null = null;
  if (status === 'scheduled') {
    const parsed = input.publishedAt ? new Date(input.publishedAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      throw new AppError('INVALID_DATA', { message: 'برای انتشار زمان‌بندی‌شده، تاریخ و ساعت معتبر وارد کنید.' });
    }
    publishedAt = parsed;
  } else if (status === 'published') {
    const parsed = input.publishedAt ? new Date(input.publishedAt) : null;
    publishedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
  } else {
    publishedAt = null;
  }

  const seo = analyzeBlogSeo({
    title,
    slug,
    metaTitle,
    metaDescription,
    focusKeyword,
    excerpt,
    contentHtml,
    coverImageUrl: coverImageUrl ?? '',
    coverImageAlt: coverImageAlt ?? '',
    tags,
  });

  return {
    categoryId,
    title,
    slug,
    excerpt,
    contentHtml,
    coverImageUrl,
    coverImageAlt,
    metaTitle,
    metaDescription,
    focusKeyword,
    tags,
    readingTimeMinutes,
    authorName,
    status,
    publishedAt,
    seoScore: seo.score,
  };
}

export const blogService = {
  // ── Public ──

  async homeLatest(limit = 3): Promise<BlogPostSummaryDTO[]> {
    const { items } = await blogRepository.listPublicPosts({ limit, offset: 0 });
    return items;
  },

  async publicIndex(params: { category?: string; tag?: string; q?: string; page?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = 9;
    const [categories, listing] = await Promise.all([
      blogRepository.listCategories({ onlyActive: true }),
      blogRepository.listPublicPosts({
        categorySlug: params.category,
        tag: params.tag,
        search: params.q,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
    ]);
    return {
      categories,
      items: listing.items,
      total: listing.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(listing.total / pageSize)),
    };
  },

  async publicDetail(slug: string): Promise<{ post: BlogPostDetailDTO; related: BlogPostSummaryDTO[] } | null> {
    const decoded = decodeURIComponent(slug).trim();
    const post = await blogRepository.findPublicPostBySlug(decoded);
    if (!post) return null;
    void blogRepository.incrementViewCount(post.id).catch(() => {});
    const related = await blogRepository.listRelatedPosts(post.id, post.categoryId, 3);
    return { post, related };
  },

  async sitemapEntries(): Promise<Array<{ path: string; lastModified: Date }>> {
    const posts = await blogRepository.sitemapPosts();
    return [
      { path: '/blog', lastModified: posts[0]?.updatedAt ?? new Date() },
      ...posts.map((p) => ({ path: `/blog/${p.slug}`, lastModified: p.updatedAt })),
    ];
  },

  // ── Admin ──

  async adminBootstrap() {
    await authorize('admin');
    const [categories, posts] = await Promise.all([
      blogRepository.listCategories({ onlyActive: false }),
      blogRepository.listAdminPosts({ status: 'all' }),
    ]);
    return { categories, posts };
  },

  async adminGetPost(id: string): Promise<BlogPostDetailDTO> {
    await authorize('admin');
    const post = await blogRepository.findAdminPostById(id);
    if (!post) throw new AppError('NOT_FOUND', { message: 'مقاله یافت نشد.' });
    return post;
  },

  async adminCreateCategory(input: {
    name?: string;
    slug?: string;
    description?: string;
    sortOrder?: number;
    isActive?: boolean;
  }): Promise<BlogCategoryDTO> {
    const admin = await authorize('admin');
    const name = cleanShort(input.name, 80);
    if (name.length < 2) throw new AppError('INVALID_DATA', { message: 'نام دسته‌بندی باید حداقل ۲ حرف باشد.' });
    const slug = slugifyBlog(cleanShort(input.slug, 80) || name);
    if (!slug) throw new AppError('INVALID_DATA', { message: 'نامک دسته‌بندی معتبر نیست.' });
    const description = cleanShort(input.description, 260) || null;
    const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.max(1, Math.min(999, Number(input.sortOrder))) : 1;
    const isActive = input.isActive !== false;

    const created = await blogRepository.createCategory({ name, slug, description, sortOrder, isActive });
    await auditRepository
      .record({
        actorUserId: admin.id,
        action: 'setting.update',
        entityType: 'blog_category',
        entityId: created.id,
        meta: { op: 'create', slug: created.slug },
        ip: null,
      })
      .catch(() => {});
    revalidatePath('/blog');
    revalidatePath('/');
    return created;
  },

  async adminUpdateCategory(
    id: string,
    input: { name?: string; slug?: string; description?: string; sortOrder?: number; isActive?: boolean },
  ): Promise<BlogCategoryDTO> {
    await authorize('admin');
    const name = cleanShort(input.name, 80);
    if (name.length < 2) throw new AppError('INVALID_DATA', { message: 'نام دسته‌بندی باید حداقل ۲ حرف باشد.' });
    const slug = slugifyBlog(cleanShort(input.slug, 80) || name);
    if (!slug) throw new AppError('INVALID_DATA', { message: 'نامک دسته‌بندی معتبر نیست.' });
    const description = cleanShort(input.description, 260) || null;
    const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.max(1, Math.min(999, Number(input.sortOrder))) : 1;
    const isActive = input.isActive !== false;

    const updated = await blogRepository.updateCategory(id, { name, slug, description, sortOrder, isActive });
    if (!updated) throw new AppError('NOT_FOUND', { message: 'دسته‌بندی یافت نشد.' });
    revalidatePath('/blog');
    revalidatePath('/');
    return updated;
  },

  async adminDeleteCategory(id: string): Promise<void> {
    await authorize('admin');
    const ok = await blogRepository.deleteCategory(id);
    if (!ok) throw new AppError('NOT_FOUND', { message: 'دسته‌بندی یافت نشد.' });
    revalidatePath('/blog');
    revalidatePath('/');
  },

  async adminCreatePost(input: BlogPostInput): Promise<BlogPostDetailDTO> {
    const admin = await authorize('admin');
    const normalized = normalizePostInput(input);
    const created = await blogRepository.createPost({ ...normalized, actorUserId: admin.id });
    await auditRepository
      .record({
        actorUserId: admin.id,
        action: 'setting.update',
        entityType: 'blog_post',
        entityId: created.id,
        meta: { op: 'create', slug: created.slug, status: created.status },
        ip: null,
      })
      .catch(() => {});
    revalidatePath('/blog');
    revalidatePath(`/blog/${created.slug}`);
    revalidatePath('/');
    return created;
  },

  async adminUpdatePost(id: string, input: BlogPostInput): Promise<BlogPostDetailDTO> {
    const admin = await authorize('admin');
    const normalized = normalizePostInput(input);
    const updated = await blogRepository.updatePost(id, { ...normalized, actorUserId: admin.id });
    if (!updated) throw new AppError('NOT_FOUND', { message: 'مقاله یافت نشد.' });
    revalidatePath('/blog');
    revalidatePath(`/blog/${updated.slug}`);
    revalidatePath('/');
    return updated;
  },

  async adminDeletePost(id: string): Promise<void> {
    await authorize('admin');
    const ok = await blogRepository.deletePost(id);
    if (!ok) throw new AppError('NOT_FOUND', { message: 'مقاله یافت نشد.' });
    revalidatePath('/blog');
    revalidatePath('/');
  },
};
