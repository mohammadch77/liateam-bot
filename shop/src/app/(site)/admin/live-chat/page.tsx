import type { Metadata } from 'next';
import { requireRole } from '@/server/auth/guards';
import { liveChatService } from '@/server/services/live-chat.service';
import { Breadcrumb } from '@/ui';
import { LiveChatPanel } from './LiveChatPanel';

export const metadata: Metadata = {
  title: 'پشتیبانی آنلاین | مدیریت',
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminLiveChatPage() {
  await requireRole('support', '/admin/live-chat');
  const initial = await liveChatService.adminBootstrap({ status: 'all' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          { label: 'مدیریت', href: '/admin' },
          { label: 'پشتیبانی آنلاین' },
        ]}
      />
      <LiveChatPanel initial={initial} />
    </div>
  );
}
