import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const data = await liveChatService.markOperatorRead(id);
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
