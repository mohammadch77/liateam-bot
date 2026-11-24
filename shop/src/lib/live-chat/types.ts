/**
 * Pure types, validation, pre-chat rules, and XSS-safe text helpers for Avina Live Chat.
 * Shared between client components, server services, and unit tests.
 */

export type ChatConversationStatus = 'pending' | 'open' | 'closed';
export type ChatSenderType = 'visitor' | 'operator' | 'system';
export type ChatMessageType = 'text' | 'image' | 'file' | 'audio';
export type ChatPreChatFieldKey = 'name' | 'email' | 'mobile';
export type ChatOperatorPresence = 'online' | 'away' | 'offline';
export type ChatWidgetPosition = 'bottom_left' | 'bottom_right';

export type ChatPreChatField = {
  key: ChatPreChatFieldKey;
  enabled: boolean;
  required: boolean;
  sortOrder: number;
};

export type ChatWidgetSettings = {
  enabled: boolean;
  widgetTitle: string;
  welcomeMessage: string;
  offlineMessage: string;
  position: ChatWidgetPosition;
  soundEnabled: boolean;
};

export type ChatVisitorPublic = {
  id: string;
  name: string | null;
  email: string | null;
  mobile: string | null;
  userId: string | null;
  currentUrl: string | null;
  currentTitle: string | null;
  lastSeenAt: string;
  online: boolean;
};

export type ChatMessageDTO = {
  id: string;
  conversationId: string;
  senderType: ChatSenderType;
  senderUserId: string | null;
  senderName: string | null;
  type: ChatMessageType;
  body: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachmentSize: number | null;
  editedAt: string | null;
  readAt: string | null;
  createdAt: string;
};

export type ChatConversationSummary = {
  id: string;
  status: ChatConversationStatus;
  assignedUserId: string | null;
  assignedUserName: string | null;
  unreadForOperator: number;
  unreadForVisitor: number;
  lastMessageAt: string;
  closedAt: string | null;
  createdAt: string;
  lastMessagePreview: string | null;
  lastMessageType: ChatMessageType | null;
  visitor: ChatVisitorPublic;
};

export type ChatOperatorDTO = {
  id: string;
  name: string;
  phone: string;
  isAdmin: boolean;
  status: ChatOperatorPresence;
  lastSeenAt: string | null;
};

export type ChatCannedResponseDTO = {
  id: string;
  shortcut: string;
  title: string;
  body: string;
};

export type ChatPageViewDTO = {
  id: string;
  url: string;
  title: string | null;
  createdAt: string;
};

export type ChatEventEnvelope = {
  event:
    | 'message.sent'
    | 'message.edited'
    | 'message.read'
    | 'typing'
    | 'conversation.updated'
    | 'conversation.assigned'
    | 'conversation.closed'
    | 'conversation.reopened'
    | 'visitor.seen'
    | 'operator.status';
  conversationId?: string;
  payload: Record<string, unknown>;
  ts: number;
};

export const PRECHAT_FIELD_LABEL: Record<ChatPreChatFieldKey, string> = {
  name: 'نام و نام خانوادگی',
  mobile: 'شماره موبایل',
  email: 'ایمیل',
};

export const PRECHAT_FIELD_PLACEHOLDER: Record<ChatPreChatFieldKey, string> = {
  name: 'مثلاً: سارا محمدی',
  mobile: '۰۹۱۲۳۴۵۶۷۸۹',
  email: 'name@example.com',
};

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

export function normalizeIranMobile(raw: string): string {
  const digits = normalizeDigits(raw).replace(/[\s\-().+]/g, '');
  if (digits.startsWith('0098') && digits.length === 14) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
}

export const IRAN_MOBILE_RE = /^09\d{9}$/;
export const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Strip ASCII control chars (except \n and \t) and Unicode BiDi override characters
 * that can spoof text direction or break UI rendering (Phase 5 XSS/text hardening).
 */
export function sanitizeChatText(input: string, maxLength = 4000): string {
  const cleaned = input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/**
 * Determine if the pre-chat form should be displayed to the visitor:
 *  - No enabled fields OR logged-in Avina user OR existing conversation -> skip
 *  - Any required field missing on visitor -> show
 *  - Only optional fields -> show once until submitted or at least one value is known
 */
export function needsPreChat(params: {
  fields: readonly Pick<ChatPreChatField, 'key' | 'enabled' | 'required'>[];
  visitor: Partial<Record<ChatPreChatFieldKey, string | null>> | null;
  isIdentifiedUser: boolean;
  submitted: boolean;
  hasConversation: boolean;
}): boolean {
  const enabled = params.fields.filter((f) => f.enabled);
  if (!enabled.length || params.isIdentifiedUser || params.hasConversation) return false;
  if (enabled.some((f) => f.required && !params.visitor?.[f.key]?.trim())) return true;
  if (enabled.some((f) => f.required)) return false;
  return !params.submitted && !enabled.some((f) => Boolean(params.visitor?.[f.key]?.trim()));
}

export function validatePreChatValues(
  fields: readonly Pick<ChatPreChatField, 'key' | 'enabled' | 'required'>[],
  values: Partial<Record<ChatPreChatFieldKey, string>>,
): Partial<Record<ChatPreChatFieldKey, string>> {
  const errors: Partial<Record<ChatPreChatFieldKey, string>> = {};
  for (const field of fields) {
    if (!field.enabled) continue;
    const raw = (values[field.key] ?? '').trim();
    if (!raw) {
      if (field.required) errors[field.key] = `لطفاً ${PRECHAT_FIELD_LABEL[field.key]} را وارد کنید.`;
      continue;
    }
    if (field.key === 'name' && raw.length < 2) {
      errors.name = 'نام باید حداقل ۲ حرف باشد.';
    } else if (field.key === 'mobile') {
      const normalized = normalizeIranMobile(raw);
      if (!IRAN_MOBILE_RE.test(normalized)) {
        errors.mobile = 'شماره موبایل معتبر وارد کنید (مثلاً ۰۹۱۲۳۴۵۶۷۸۹).';
      }
    } else if (field.key === 'email' && !SIMPLE_EMAIL_RE.test(raw)) {
      errors.email = 'آدرس ایمیل معتبر وارد کنید.';
    }
  }
  return errors;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export type TextSegment = { kind: 'text'; value: string } | { kind: 'link'; value: string; href: string };

const SAFE_URL_RE = /(https?:\/\/[^\s<>"'`]+)/gi;

/** Split plain message text into safe text & http(s) link segments without ever using innerHTML. */
export function linkifyParts(text: string): TextSegment[] {
  if (!text) return [];
  const out: TextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(SAFE_URL_RE)) {
    const start = match.index ?? 0;
    const rawUrl = match[0];
    if (start > lastIndex) out.push({ kind: 'text', value: text.slice(lastIndex, start) });
    // Trim trailing punctuation often attached in prose
    const cleanUrl = rawUrl.replace(/[.,;:!?)]+$/, '');
    out.push({ kind: 'link', value: cleanUrl, href: cleanUrl });
    lastIndex = start + cleanUrl.length;
  }
  if (lastIndex < text.length) out.push({ kind: 'text', value: text.slice(lastIndex) });
  return out;
}

export const CHAT_ALLOWED_MIMES: Record<string, { type: Exclude<ChatMessageType, 'text'>; ext: string }> = {
  'image/jpeg': { type: 'image', ext: 'jpg' },
  'image/png': { type: 'image', ext: 'png' },
  'image/webp': { type: 'image', ext: 'webp' },
  'image/gif': { type: 'image', ext: 'gif' },
  'audio/webm': { type: 'audio', ext: 'webm' },
  'audio/ogg': { type: 'audio', ext: 'ogg' },
  'audio/mpeg': { type: 'audio', ext: 'mp3' },
  'audio/mp4': { type: 'audio', ext: 'm4a' },
  'audio/wav': { type: 'audio', ext: 'wav' },
  'application/pdf': { type: 'file', ext: 'pdf' },
  'text/plain': { type: 'file', ext: 'txt' },
  'application/zip': { type: 'file', ext: 'zip' },
};

export const CHAT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const CHAT_VISITOR_ONLINE_WINDOW_MS = 90_000;
