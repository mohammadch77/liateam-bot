import type { ChatConversationStatus } from '@/lib/live-chat/types';
import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawStatus = url.searchParams.get('status') ?? 'all';
    const status = (['pending', 'open', 'closed', 'all'].includes(rawStatus)
      ? rawStatus
      : 'all') as ChatConversationStatus | 'all';
    const search = url.searchParams.get('q') ?? undefined;
    const data = await liveChatService.adminBootstrap({ status, search });
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
