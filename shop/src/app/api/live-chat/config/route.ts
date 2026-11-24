import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await liveChatService.widgetConfig();
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
