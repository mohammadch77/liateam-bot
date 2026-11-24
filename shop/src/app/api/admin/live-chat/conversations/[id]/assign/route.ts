import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { userId?: string };
    const data = await liveChatService.assignOrTransferConversation(id, String(body.userId ?? ''));
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
