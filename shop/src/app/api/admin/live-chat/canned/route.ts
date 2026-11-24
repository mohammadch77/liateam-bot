import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const items = await liveChatService.listCannedResponses();
    return chatJson({ ok: true, items });
  } catch (err) {
    return chatError(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      shortcut?: string;
      title?: string;
      body?: string;
    };
    const item = await liveChatService.createCannedResponse({
      shortcut: String(body.shortcut ?? ''),
      title: String(body.title ?? ''),
      body: String(body.body ?? ''),
    });
    return chatJson({ ok: true, item }, 201);
  } catch (err) {
    return chatError(err);
  }
}
