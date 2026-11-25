import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import type {
  BlogCategoryDTO,
  BlogPostDetailDTO,
  BlogPostStatus,
  BlogPostSummaryDTO,
} from '@/lib/blog/seo';

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  post_count?: string;
};

type PostRow = {
  id: string;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  title: string;
  slug: string;
  excerpt: string;
  content_html?: string;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  meta_title: string;
  meta_description: string;
  focus_keyword: string;
  tags: string[] | null;
  reading_time_minutes: number;
  author_name: string;
  status: BlogPostStatus;
  published_at: Date | null;
  seo_score: number;
  view_count: number;
  created_at: Date;
  updated_at: Date;
};

function computeEffectiveStatus(status: BlogPostStatus, publishedAt: Date | null): BlogPostStatus {
  if (status === 'scheduled' && publishedAt && publishedAt.getTime() <= Date.now()) {
    return 'published';
  }
  return status;
}

function mapCategory(r: CategoryRow): BlogCategoryDTO {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    sortOrder: Number(r.sort_order) || 1,
    isActive: r.is_active,
    postCount: r.post_count !== undefined ? Number(r.post_count) || 0 : undefined,
  };
}

function mapPostSummary(r: PostRow): BlogPostSummaryDTO {
  return {
    id: r.id,
    categoryId: r.category_id,
    categoryName: r.category_name,
    categorySlug: r.category_slug,
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt,
    coverImageUrl: r.cover_image_url,
    coverImageAlt: r.cover_image_alt,
    metaTitle: r.meta_title,
    metaDescription: r.meta_description,
    focusKeyword: r.focus_keyword,
    tags: Array.isArray(r.tags) ? r.tags : [],
    readingTimeMinutes: Number(r.reading_time_minutes) || 3,
    authorName: r.author_name,
    status: r.status,
    effectiveStatus: computeEffectiveStatus(r.status, r.published_at),
    publishedAt: r.published_at ? r.published_at.toISOString() : null,
    seoScore: Number(r.seo_score) || 0,
    viewCount: Number(r.view_count) || 0,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function mapPostDetail(r: PostRow): BlogPostDetailDTO {
  return {
    ...mapPostSummary(r),
    contentHtml: r.content_html ?? '',
  };
}

/** Public visibility condition: published OR scheduled whose publish timestamp has arrived. */
const PUBLIC_POST_COND = `(p.status = 'published' OR (p.status = 'scheduled' AND p.published_at IS NOT NULL AND p.published_at <= now()))`;

const SUMMARY_SELECT = `
  SELECT p.id::text, p.category_id::text, c.name AS category_name, c.slug AS category_slug,
         p.title, p.slug, p.excerpt, p.cover_image_url, p.cover_image_alt,
         p.meta_title, p.meta_description, p.focus_keyword, p.tags,
         p.reading_time_minutes, p.author_name, p.status, p.published_at,
         p.seo_score, p.view_count, p.created_at, p.updated_at
    FROM blog_posts p
    LEFT JOIN blog_categories c ON c.id = p.category_id
`;

const DETAIL_SELECT = `
  SELECT p.id::text, p.category_id::text, c.name AS category_name, c.slug AS category_slug,
         p.title, p.slug, p.excerpt, p.content_html, p.cover_image_url, p.cover_image_alt,
         p.meta_title, p.meta_description, p.focus_keyword, p.tags,
         p.reading_time_minutes, p.author_name, p.status, p.published_at,
         p.seo_score, p.view_count, p.created_at, p.updated_at
    FROM blog_posts p
    LEFT JOIN blog_categories c ON c.id = p.category_id
`;

export const blogRepository = {
  // ── Categories ──

  async listCategories(opts: { onlyActive?: boolean } = {}, db?: Queryable): Promise<BlogCategoryDTO[]> {
    const activeCond = opts.onlyActive ? `WHERE c.is_active = TRUE` : '';
    const rows = await query<CategoryRow>(
      'blog.list_categories',
      `SELECT c.id::text, c.name, c.slug, c.description, c.sort_order, c.is_active,
              COUNT(p.id) FILTER (WHERE ${PUBLIC_POST_COND})::text AS post_count
         FROM blog_categories c
         LEFT JOIN blog_posts p ON p.category_id = c.id
        ${activeCond}
        GROUP BY c.id
        ORDER BY c.sort_order ASC, c.id ASC`,
      [],
      db,
    );
    return rows.map(mapCategory);
  },

  async findCategoryById(id: string, db?: Queryable): Promise<BlogCategoryDTO | null> {
    const row = await queryOne<CategoryRow>(
      'blog.find_category_by_id',
      `SELECT id::text, name, slug, description, sort_order, is_active FROM blog_categories WHERE id = $1`,
      [id],
      db,
    );
    return row ? mapCategory(row) : null;
  },

  async createCategory(
    input: { name: string; slug: string; description: string | null; sortOrder: number; isActive: boolean },
    db?: Queryable,
  ): Promise<BlogCategoryDTO> {
    const row = await queryOne<CategoryRow>(
      'blog.create_category',
      `INSERT INTO blog_categories (name, slug, description, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::text, name, slug, description, sort_order, is_active`,
      [input.name, input.slug, input.description, input.sortOrder, input.isActive],
      db,
    );
    return mapCategory(row!);
  },

  async updateCategory(
    id: string,
    input: { name: string; slug: string; description: string | null; sortOrder: number; isActive: boolean },
    db?: Queryable,
  ): Promise<BlogCategoryDTO | null> {
    const row = await queryOne<CategoryRow>(
      'blog.update_category',
      `UPDATE blog_categories
          SET name = $2, slug = $3, description = $4, sort_order = $5, is_active = $6, updated_at = now()
        WHERE id = $1
        RETURNING id::text, name, slug, description, sort_order, is_active`,
      [id, input.name, input.slug, input.description, input.sortOrder, input.isActive],
      db,
    );
    return row ? mapCategory(row) : null;
  },

  async deleteCategory(id: string, db?: Queryable): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'blog.delete_category',
      `DELETE FROM blog_categories WHERE id = $1 RETURNING id::text`,
      [id],
      db,
    );
    return rows.length > 0;
  },

  // ── Public Posts ──

  async listPublicPosts(
    filter: { categorySlug?: string; tag?: string; search?: string; limit?: number; offset?: number } = {},
    db?: Queryable,
  ): Promise<{ items: BlogPostSummaryDTO[]; total: number }> {
    const params: unknown[] = [];
    const where: string[] = [PUBLIC_POST_COND];

    if (filter.categorySlug?.trim()) {
      params.push(filter.categorySlug.trim());
      where.push(`c.slug = $${params.length}`);
    }
    if (filter.tag?.trim()) {
      params.push(filter.tag.trim());
      where.push(`$${params.length} = ANY(p.tags)`);
    }
    if (filter.search?.trim()) {
      params.push(`%${filter.search.trim()}%`);
      const p = `$${params.length}`;
      where.push(`(p.title ILIKE ${p} OR p.excerpt ILIKE ${p} OR p.focus_keyword ILIKE ${p})`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const countRow = await queryOne<{ cnt: string }>(
      'blog.count_public_posts',
      `SELECT COUNT(*)::text AS cnt FROM blog_posts p LEFT JOIN blog_categories c ON c.id = p.category_id ${whereSql}`,
      params,
      db,
    );

    const limit = Math.min(48, Math.max(1, filter.limit ?? 12));
    const offset = Math.max(0, filter.offset ?? 0);
    const listParams = [...params, limit, offset];

    const rows = await query<PostRow>(
      'blog.list_public_posts',
      `${SUMMARY_SELECT}
       ${whereSql}
       ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
      db,
    );

    return {
      items: rows.map(mapPostSummary),
      total: Number(countRow?.cnt ?? '0'),
    };
  },

  async findPublicPostBySlug(slug: string, db?: Queryable): Promise<BlogPostDetailDTO | null> {
    const row = await queryOne<PostRow>(
      'blog.find_public_post_by_slug',
      `${DETAIL_SELECT} WHERE p.slug = $1 AND ${PUBLIC_POST_COND}`,
      [slug],
      db,
    );
    return row ? mapPostDetail(row) : null;
  },

  async incrementViewCount(id: string, db?: Queryable): Promise<void> {
    await query('blog.inc_view', `UPDATE blog_posts SET view_count = view_count + 1 WHERE id = $1`, [id], db);
  },

  async listRelatedPosts(
    postId: string,
    categoryId: string | null,
    limit = 3,
    db?: Queryable,
  ): Promise<BlogPostSummaryDTO[]> {
    const rows = await query<PostRow>(
      'blog.list_related',
      `${SUMMARY_SELECT}
       WHERE ${PUBLIC_POST_COND} AND p.id <> $1
       ORDER BY CASE WHEN p.category_id IS NOT NULL AND p.category_id = $2 THEN 0 ELSE 1 END,
                COALESCE(p.published_at, p.created_at) DESC
       LIMIT $3`,
      [postId, categoryId, limit],
      db,
    );
    return rows.map(mapPostSummary);
  },

  async sitemapPosts(db?: Queryable): Promise<Array<{ slug: string; updatedAt: Date }>> {
    const rows = await query<{ slug: string; updated_at: Date }>(
      'blog.sitemap_posts',
      `SELECT p.slug, p.updated_at FROM blog_posts p WHERE ${PUBLIC_POST_COND} ORDER BY p.published_at DESC`,
      [],
      db,
    );
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
  },

  // ── Admin Posts ──

  async listAdminPosts(
    filter: { status?: BlogPostStatus | 'all'; categoryId?: string; search?: string } = {},
    db?: Queryable,
  ): Promise<BlogPostSummaryDTO[]> {
    const params: unknown[] = [];
    const where: string[] = [];

    if (filter.status && filter.status !== 'all') {
      if (filter.status === 'published') {
        where.push(PUBLIC_POST_COND);
      } else if (filter.status === 'scheduled') {
        where.push(`p.status = 'scheduled' AND (p.published_at IS NULL OR p.published_at > now())`);
      } else {
        where.push(`p.status = 'draft'`);
      }
    }
    if (filter.categoryId?.trim()) {
      params.push(filter.categoryId.trim());
      where.push(`p.category_id = $${params.length}`);
    }
    if (filter.search?.trim()) {
      params.push(`%${filter.search.trim()}%`);
      const p = `$${params.length}`;
      where.push(`(p.title ILIKE ${p} OR p.slug ILIKE ${p} OR p.focus_keyword ILIKE ${p} OR p.author_name ILIKE ${p})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query<PostRow>(
      'blog.list_admin_posts',
      `${SUMMARY_SELECT} ${whereSql} ORDER BY p.updated_at DESC, p.id DESC LIMIT 200`,
      params,
      db,
    );
    return rows.map(mapPostSummary);
  },

  async findAdminPostById(id: string, db?: Queryable): Promise<BlogPostDetailDTO | null> {
    const row = await queryOne<PostRow>(
      'blog.find_admin_post_by_id',
      `${DETAIL_SELECT} WHERE p.id = $1`,
      [id],
      db,
    );
    return row ? mapPostDetail(row) : null;
  },

  async createPost(
    input: {
      categoryId: string | null;
      title: string;
      slug: string;
      excerpt: string;
      contentHtml: string;
      coverImageUrl: string | null;
      coverImageAlt: string | null;
      metaTitle: string;
      metaDescription: string;
      focusKeyword: string;
      tags: string[];
      readingTimeMinutes: number;
      authorName: string;
      status: BlogPostStatus;
      publishedAt: Date | null;
      seoScore: number;
      actorUserId: string;
    },
    db?: Queryable,
  ): Promise<BlogPostDetailDTO> {
    const inserted = await queryOne<{ id: string }>(
      'blog.create_post',
      `INSERT INTO blog_posts (
         category_id, title, slug, excerpt, content_html,
         cover_image_url, cover_image_alt, meta_title, meta_description,
         focus_keyword, tags, reading_time_minutes, author_name,
         status, published_at, seo_score, created_by, updated_by
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11::text[], $12, $13,
         $14::blog_post_status, $15, $16, $17, $17
       )
       RETURNING id::text`,
      [
        input.categoryId,
        input.title,
        input.slug,
        input.excerpt,
        input.contentHtml,
        input.coverImageUrl,
        input.coverImageAlt,
        input.metaTitle,
        input.metaDescription,
        input.focusKeyword,
        input.tags,
        input.readingTimeMinutes,
        input.authorName,
        input.status,
        input.publishedAt,
        input.seoScore,
        input.actorUserId,
      ],
      db,
    );
    const full = await this.findAdminPostById(inserted!.id, db);
    return full!;
  },

  async updatePost(
    id: string,
    input: {
      categoryId: string | null;
      title: string;
      slug: string;
      excerpt: string;
      contentHtml: string;
      coverImageUrl: string | null;
      coverImageAlt: string | null;
      metaTitle: string;
      metaDescription: string;
      focusKeyword: string;
      tags: string[];
      readingTimeMinutes: number;
      authorName: string;
      status: BlogPostStatus;
      publishedAt: Date | null;
      seoScore: number;
      actorUserId: string;
    },
    db?: Queryable,
  ): Promise<BlogPostDetailDTO | null> {
    const updated = await queryOne<{ id: string }>(
      'blog.update_post',
      `UPDATE blog_posts
          SET category_id = $2,
              title = $3,
              slug = $4,
              excerpt = $5,
              content_html = $6,
              cover_image_url = $7,
              cover_image_alt = $8,
              meta_title = $9,
              meta_description = $10,
              focus_keyword = $11,
              tags = $12::text[],
              reading_time_minutes = $13,
              author_name = $14,
              status = $15::blog_post_status,
              published_at = $16,
              seo_score = $17,
              updated_by = $18,
              updated_at = now()
        WHERE id = $1
        RETURNING id::text`,
      [
        id,
        input.categoryId,
        input.title,
        input.slug,
        input.excerpt,
        input.contentHtml,
        input.coverImageUrl,
        input.coverImageAlt,
        input.metaTitle,
        input.metaDescription,
        input.focusKeyword,
        input.tags,
        input.readingTimeMinutes,
        input.authorName,
        input.status,
        input.publishedAt,
        input.seoScore,
        input.actorUserId,
      ],
      db,
    );
    if (!updated) return null;
    return this.findAdminPostById(id, db);
  },

  async deletePost(id: string, db?: Queryable): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'blog.delete_post',
      `DELETE FROM blog_posts WHERE id = $1 RETURNING id::text`,
      [id],
      db,
    );
    return rows.length > 0;
  },
};
