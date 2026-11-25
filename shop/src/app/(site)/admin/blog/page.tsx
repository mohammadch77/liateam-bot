import type { Metadata } from 'next';
import { requireRole } from '@/server/auth/guards';
import { blogService } from '@/server/services/blog.service';
import { Breadcrumb } from '@/ui';
import { BlogAdminClient } from './BlogAdminClient';

export const metadata: Metadata = {
  title: 'مدیریت وبلاگ | مدیریت',
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminBlogPage() {
  await requireRole('admin', '/admin/blog');
  const { categories, posts } = await blogService.adminBootstrap();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          { label: 'مدیریت', href: '/admin' },
          { label: 'وبلاگ و مقالات' },
        ]}
      />
      <BlogAdminClient initialCategories={categories} initialPosts={posts} />
    </div>
  );
}
