import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      shortcut?: string;
      title?: string;
      body?: string;
    };
    const item = await liveChatService.updateCannedResponse(id, {
      shortcut: String(body.shortcut ?? ''),
      title: String(body.title ?? ''),
      body: String(body.body ?? ''),
    });
    return chatJson({ ok: true, item });
  } catch (err) {
    return chatError(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await liveChatService.deleteCannedResponse(id);
    return chatJson({ ok: true });
  } catch (err) {
    return chatError(err);
  }
}
