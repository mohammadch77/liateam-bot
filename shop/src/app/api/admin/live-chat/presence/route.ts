import type { ChatOperatorPresence } from '@/lib/live-chat/types';
import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { status?: ChatOperatorPresence };
    const data = await liveChatService.setOperatorPresence(body.status ?? 'online');
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
