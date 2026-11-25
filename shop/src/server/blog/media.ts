import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@/lib/errors';

const ALLOWED_IMAGE_MIMES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const SAFE_FILENAME_RE = /^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/i;

function mediaRoot(): string {
  const configured = process.env.BLOG_UPLOAD_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), 'storage', 'blog-media');
}

export async function saveBlogImageUpload(file: File): Promise<{ url: string; fileName: string; mime: string; size: number }> {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new AppError('INVALID_DATA', { message: 'فایل تصویر ارسال نشده است.' });
  }
  if (file.size <= 0) {
    throw new AppError('INVALID_DATA', { message: 'فایل تصویر خالی است.' });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AppError('INVALID_DATA', { message: 'حداکثر حجم مجاز هر تصویر ۸ مگابایت است.' });
  }

  const mime = (file.type || '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = ALLOWED_IMAGE_MIMES[mime];
  if (!ext) {
    throw new AppError('INVALID_DATA', { message: 'فقط تصاویر JPG، PNG، WebP و GIF مجاز هستند.' });
  }

  const fileName = `${crypto.randomUUID()}.${ext}`;
  const root = mediaRoot();
  await fs.mkdir(root, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(root, fileName), buf);

  return {
    url: `/api/blog/media/${fileName}`,
    fileName,
    mime,
    size: buf.byteLength,
  };
}

export async function readBlogImageFile(fileName: string): Promise<{ buffer: Buffer; mime: string } | null> {
  if (!SAFE_FILENAME_RE.test(fileName)) return null;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mime =
    ext === 'jpg'
      ? 'image/jpeg'
      : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : null;
  if (!mime) return null;

  const fullPath = path.join(mediaRoot(), fileName);
  try {
    const buffer = await fs.readFile(/*turbopackIgnore: true*/ fullPath);
    return { buffer, mime };
  } catch {
    return null;
  }
}
