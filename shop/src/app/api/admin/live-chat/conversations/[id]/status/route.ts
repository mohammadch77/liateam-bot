import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { status?: string };
    const nextStatus = body.status === 'open' ? 'open' : 'closed';
    const data = await liveChatService.setConversationStatus(id, nextStatus);
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
