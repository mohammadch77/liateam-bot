import { readBlogImageFile } from '@/server/blog/media';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  const data = await readBlogImageFile(file);
  if (!data) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(new Uint8Array(data.buffer), {
    status: 200,
    headers: {
      'Content-Type': data.mime,
      'Content-Length': String(data.buffer.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
