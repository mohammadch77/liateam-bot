import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { isTyping?: boolean };
    await liveChatService.emitOperatorTyping(id, Boolean(body.isTyping));
    return chatJson({ ok: true });
  } catch (err) {
    return chatError(err);
  }
}
