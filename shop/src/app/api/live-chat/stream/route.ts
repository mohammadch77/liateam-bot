import { chatError, readVisitorToken } from '@/server/live-chat/http';
import { createSseResponse } from '@/server/live-chat/realtime';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const token = readVisitorToken(request);
    const visitor = await liveChatService.requireVisitorByToken(token);
    return createSseResponse(`visitor:${visitor.visitor_token.trim()}`, request.signal);
  } catch (err) {
    return chatError(err);
  }
}
