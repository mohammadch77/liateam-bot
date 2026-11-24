import { chatError, chatJson } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const contentType = request.headers.get('content-type') ?? '';
    let bodyText: string | null = null;
    let file: File | null = null;
    let isVoice = false;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const rawBody = form.get('body');
      bodyText = typeof rawBody === 'string' ? rawBody : null;
      const rawFile = form.get('file');
      file = rawFile instanceof File ? rawFile : null;
      isVoice = form.get('voice') === '1' || form.get('voice') === 'true';
    } else {
      const json = (await request.json().catch(() => ({}))) as { body?: unknown };
      bodyText = typeof json.body === 'string' ? json.body : null;
    }

    const data = await liveChatService.sendOperatorMessage({
      conversationId: id,
      body: bodyText,
      file,
      isVoice,
    });
    return chatJson({ ok: true, ...data }, 201);
  } catch (err) {
    return chatError(err);
  }
}
