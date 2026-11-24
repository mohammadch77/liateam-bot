import { chatError, readVisitorToken } from '@/server/live-chat/http';
import { liveChatService } from '@/server/services/live-chat.service';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const token = readVisitorToken(request);
    const data = await liveChatService.readAttachmentAuthorized(id, token);
    const disposition = data.inline ? 'inline' : 'attachment';
    const encodedName = encodeURIComponent(data.fileName);

    return new Response(new Uint8Array(data.buffer), {
      status: 200,
      headers: {
        'Content-Type': data.mime,
        'Content-Length': String(data.buffer.byteLength),
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodedName}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (err) {
    return chatError(err);
  }
}
