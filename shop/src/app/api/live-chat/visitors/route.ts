import { chatError, chatJson, readClientIp, readVisitorToken } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const token = readVisitorToken(request) ?? (typeof body.visitorToken === 'string' ? body.visitorToken : null);
    const data = await liveChatService.registerVisitor({
      token,
      currentUrl: typeof body.currentUrl === 'string' ? body.currentUrl : null,
      currentTitle: typeof body.currentTitle === 'string' ? body.currentTitle : null,
      referrer: typeof body.referrer === 'string' ? body.referrer : null,
      ipAddress: readClientIp(request),
      userAgent: request.headers.get('user-agent'),
    });
    return chatJson({ ok: true, ...data });
  } catch (err) {
    return chatError(err);
  }
}
