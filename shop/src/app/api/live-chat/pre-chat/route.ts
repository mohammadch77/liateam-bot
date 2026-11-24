import type { ChatPreChatFieldKey } from '@/lib/live-chat/types';
import { chatError, chatJson, readVisitorToken } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const token = readVisitorToken(request);
    if (!token) return chatJson({ ok: false, message: 'شناسه بازدیدکننده ارسال نشده است.' }, 401);
    const body = (await request.json().catch(() => ({}))) as Partial<Record<ChatPreChatFieldKey, string>>;
    const data = await liveChatService.submitPreChat(token, {
      name: typeof body.name === 'string' ? body.name : undefined,
      mobile: typeof body.mobile === 'string' ? body.mobile : undefined,
      email: typeof body.email === 'string' ? body.email : undefined,
    });
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
