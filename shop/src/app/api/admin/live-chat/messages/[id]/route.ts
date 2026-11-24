import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { body?: string };
    const data = await liveChatService.editOperatorMessage(id, typeof body.body === 'string' ? body.body : '');
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
