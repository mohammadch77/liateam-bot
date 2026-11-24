import { chatError, chatJson, readVisitorToken } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const token = readVisitorToken(request);
    if (!token) return chatJson({ ok: false, message: 'شناسه بازدیدکننده ارسال نشده است.' }, 401);
    const data = await liveChatService.visitorConversation(token);
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
