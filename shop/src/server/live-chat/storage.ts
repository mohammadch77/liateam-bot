import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@/lib/errors';
import { CHAT_ALLOWED_MIMES, CHAT_MAX_UPLOAD_BYTES, type ChatMessageType } from '@/lib/live-chat/types';

function storageRoot(): string {
  const configured = process.env.CHAT_UPLOAD_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), 'storage', 'chat-attachments');
}

function safeFileName(raw: string, fallbackExt: string): string {
  const base = path.basename(raw || '').replace(/[\u0000-\u001F\u007F<>:"/\\|?*]+/g, '_').trim();
  if (!base) return `attachment.${fallbackExt}`;
  return base.length > 140 ? base.slice(0, 140) : base;
}

export type StoredAttachment = {
  relativePath: string;
  originalName: string;
  mime: string;
  size: number;
  messageType: Exclude<ChatMessageType, 'text'>;
};

export async function saveChatUpload(file: File, forceVoice = false): Promise<StoredAttachment> {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new AppError('INVALID_DATA', { message: 'فایل پیوست ارسال نشده است.' });
  }
  if (file.size <= 0) {
    throw new AppError('INVALID_DATA', { message: 'فایل انتخاب‌شده خالی است.' });
  }
  if (file.size > CHAT_MAX_UPLOAD_BYTES) {
    throw new AppError('INVALID_DATA', { message: 'حداکثر حجم مجاز فایل ۱۰ مگابایت است.' });
  }

  const baseMime = (file.type || '').split(';')[0]?.trim().toLowerCase() ?? '';
  const rule = CHAT_ALLOWED_MIMES[baseMime];
  if (!rule) {
    throw new AppError('INVALID_DATA', {
      message: 'فرمت فایل مجاز نیست (تصویر، صدا، PDF، TXT یا ZIP قابل ارسال است).',
    });
  }

  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const fileId = `${crypto.randomUUID()}.${rule.ext}`;
  const relativePath = `${ym}/${fileId}`;
  const root = storageRoot();
  const fullPath = path.join(root, ym, fileId);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buf);

  return {
    relativePath,
    originalName: safeFileName(file.name, rule.ext),
    mime: baseMime,
    size: buf.byteLength,
    messageType: forceVoice && rule.type === 'audio' ? 'audio' : rule.type,
  };
}

export async function readChatUpload(relativePath: string): Promise<Buffer | null> {
  // Prevent path traversal strictly
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/')) return null;
  const root = storageRoot();
  const fullPath = path.resolve(root, normalized);
  if (!fullPath.startsWith(root)) return null;
  try {
    return await fs.readFile(fullPath);
  } catch {
    return null;
  }
}
