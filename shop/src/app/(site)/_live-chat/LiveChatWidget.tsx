'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { toFaDigits } from '@/lib/format/number';
import { playChatChime } from '@/lib/live-chat/sound';
import {
  formatFileSize,
  linkifyParts,
  needsPreChat,
  PRECHAT_FIELD_LABEL,
  PRECHAT_FIELD_PLACEHOLDER,
  validatePreChatValues,
  type ChatConversationSummary,
  type ChatEventEnvelope,
  type ChatMessageDTO,
  type ChatPreChatField,
  type ChatPreChatFieldKey,
  type ChatVisitorPublic,
  type ChatWidgetSettings,
} from '@/lib/live-chat/types';
import { Icon } from '@/ui';
import s from './live-chat-widget.module.css';

const STORAGE_TOKEN = 'avina_lc_visitor_token';
const STORAGE_PRECHAT = 'avina_lc_prechat_done';

const timeFa = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });

function fmtTime(iso: string): string {
  try {
    return timeFa.format(new Date(iso));
  } catch {
    return '';
  }
}

function MessageText({ text }: { text: string }) {
  const parts = useMemo(() => linkifyParts(text), [text]);
  return (
    <>
      {parts.map((part, idx) =>
        part.kind === 'link' ? (
          <a
            key={idx}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={s.msgLink}
          >
            {part.value}
          </a>
        ) : (
          <span key={idx}>{part.value}</span>
        ),
      )}
    </>
  );
}

declare global {
  interface Window {
    AvinaLiveChat?: {
      open: () => void;
      close: () => void;
      toggle: () => void;
    };
  }
}

export function LiveChatWidget() {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith('/admin');

  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<ChatWidgetSettings | null>(null);
  const [preChatFields, setPreChatFields] = useState<ChatPreChatField[]>([]);
  const [operatorOnline, setOperatorOnline] = useState(false);
  const [isIdentifiedUser, setIsIdentifiedUser] = useState(false);

  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const [visitor, setVisitor] = useState<ChatVisitorPublic | null>(null);
  const [conversation, setConversation] = useState<ChatConversationSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);

  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [operatorTyping, setOperatorTyping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-chat state
  const [preChatSubmitted, setPreChatSubmitted] = useState(false);
  const [preValues, setPreValues] = useState<Partial<Record<ChatPreChatFieldKey, string>>>({});
  const [preErrors, setPreErrors] = useState<Partial<Record<ChatPreChatFieldKey, string>>>({});
  const [preBusy, setPreBusy] = useState(false);

  // Composer state
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [recordingSec, setRecordingSec] = useState<number | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isOpenRef = useRef(false);
  const soundEnabledRef = useRef(true);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);
  const recorderRef = useRef<{
    recorder: MediaRecorder;
    chunks: Blob[];
    timer: ReturnType<typeof setInterval>;
    cancelled: boolean;
  } | null>(null);

  isOpenRef.current = isOpen;
  soundEnabledRef.current = settings?.soundEnabled ?? true;

  // Expose tiny public SDK on window
  useEffect(() => {
    window.AvinaLiveChat = {
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((v) => !v),
    };
    return () => {
      delete window.AvinaLiveChat;
    };
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }, []);

  // Load config + register visitor once
  useEffect(() => {
    if (isAdminRoute) return;
    let alive = true;

    async function boot() {
      try {
        const cfgRes = await fetch('/api/live-chat/config', { cache: 'no-store' });
        const cfg = await cfgRes.json();
        if (!alive || !cfg.ok) return;

        setSettings(cfg.settings);
        setPreChatFields(cfg.preChatFields ?? []);
        setOperatorOnline(Boolean(cfg.operatorOnline));
        setIsIdentifiedUser(Boolean(cfg.signedInUser));
        setPreChatSubmitted(Boolean(localStorage.getItem(STORAGE_PRECHAT)));

        if (!cfg.settings?.enabled) {
          setReady(true);
          return;
        }

        const storedToken = localStorage.getItem(STORAGE_TOKEN);
        const regRes = await fetch('/api/live-chat/visitors', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(storedToken ? { 'X-Visitor-Token': storedToken } : {}),
          },
          body: JSON.stringify({
            currentUrl: window.location.pathname + window.location.search,
            currentTitle: document.title,
            referrer: document.referrer || null,
          }),
        });
        const reg = await regRes.json();
        if (!alive || !reg.ok) return;

        const tok: string = reg.visitorToken;
        localStorage.setItem(STORAGE_TOKEN, tok);
        setVisitorToken(tok);
        setVisitor(reg.visitor);
        setIsIdentifiedUser(Boolean(reg.isIdentifiedUser));

        setPreValues({
          name: reg.visitor?.name ?? '',
          mobile: reg.visitor?.mobile ?? '',
          email: reg.visitor?.email ?? '',
        });

        // Fetch existing conversation (returning visitor continuation)
        const convRes = await fetch('/api/live-chat/conversation', {
          headers: { 'X-Visitor-Token': tok },
          cache: 'no-store',
        });
        const convData = await convRes.json();
        if (!alive || !convData.ok) return;

        setConversation(convData.conversation ?? null);
        setMessages(convData.messages ?? []);
        setUnread(convData.conversation?.unreadForVisitor ?? 0);
        setReady(true);
      } catch {
        // fail silently on storefront
      }
    }

    void boot();
    return () => {
      alive = false;
    };
  }, [isAdminRoute]);

  // Track SPA route changes for live operator visitor view
  useEffect(() => {
    if (isAdminRoute || !visitorToken || !settings?.enabled) return;
    const timer = setTimeout(() => {
      void fetch('/api/live-chat/visitors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Visitor-Token': visitorToken,
        },
        body: JSON.stringify({
          currentUrl: window.location.pathname + window.location.search,
          currentTitle: document.title,
        }),
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [pathname, visitorToken, isAdminRoute, settings?.enabled]);

  // Mark operator messages read when widget is open
  const markRead = useCallback(async () => {
    if (!visitorToken) return;
    setUnread(0);
    await fetch('/api/live-chat/read', {
      method: 'POST',
      headers: { 'X-Visitor-Token': visitorToken },
    }).catch(() => {});
  }, [visitorToken]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom(false);
      if (unread > 0) void markRead();
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen, unread, markRead, scrollToBottom]);

  // Subscribe to SSE real-time stream
  useEffect(() => {
    if (isAdminRoute || !visitorToken || !settings?.enabled) return;

    const es = new EventSource(`/api/live-chat/stream?token=${encodeURIComponent(visitorToken)}`);

    const handleMessageSent = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const msg = env.payload.message as ChatMessageDTO | undefined;
        const conv = env.payload.conversation as ChatConversationSummary | undefined;
        if (conv) setConversation(conv);
        if (msg && msg.senderType !== 'system') {
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          if (msg.senderType === 'operator') {
            setOperatorTyping(null);
            if (isOpenRef.current) {
              void markRead();
            } else {
              setUnread((u) => u + 1);
            }
            if (soundEnabledRef.current) playChatChime('visitor');
          }
        }
      } catch {
        // ignore parse error
      }
    };

    const handleMessageEdited = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const msg = env.payload.message as ChatMessageDTO | undefined;
        if (!msg) return;
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      } catch {
        // ignore
      }
    };

    const handleRead = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const reader = env.payload.reader as string | undefined;
        const readAt = (env.payload.readAt as string) || new Date().toISOString();
        if (reader === 'operator') {
          setMessages((prev) =>
            prev.map((m) => (m.senderType === 'visitor' && !m.readAt ? { ...m, readAt } : m)),
          );
        }
      } catch {
        // ignore
      }
    };

    const handleTyping = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        if (env.payload.senderType !== 'operator') return;
        const active = Boolean(env.payload.isTyping);
        const name = (env.payload.operatorName as string) || 'پشتیبان';
        setOperatorTyping(active ? name : null);
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        if (active) {
          typingTimerRef.current = setTimeout(() => setOperatorTyping(null), 5000);
        }
      } catch {
        // ignore
      }
    };

    const handleStatus = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const conv = env.payload.conversation as ChatConversationSummary | undefined;
        if (conv) setConversation(conv);
      } catch {
        // ignore
      }
    };

    es.addEventListener('message.sent', handleMessageSent);
    es.addEventListener('message.edited', handleMessageEdited);
    es.addEventListener('message.read', handleRead);
    es.addEventListener('typing', handleTyping);
    es.addEventListener('conversation.closed', handleStatus);
    es.addEventListener('conversation.reopened', handleStatus);

    return () => {
      es.close();
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [isAdminRoute, visitorToken, settings?.enabled, markRead]);

  // Auto-scroll on new message or typing indicator
  useEffect(() => {
    if (isOpen) scrollToBottom(true);
  }, [messages.length, operatorTyping, isOpen, scrollToBottom]);

  const showPreChat = useMemo(
    () =>
      needsPreChat({
        fields: preChatFields,
        visitor,
        isIdentifiedUser,
        submitted: preChatSubmitted,
        hasConversation: Boolean(conversation),
      }),
    [preChatFields, visitor, isIdentifiedUser, preChatSubmitted, conversation],
  );

  const enabledFields = useMemo(
    () => [...preChatFields].filter((f) => f.enabled).sort((a, b) => a.sortOrder - b.sortOrder),
    [preChatFields],
  );

  const submitPreChat = async (e: FormEvent) => {
    e.preventDefault();
    if (!visitorToken || preBusy) return;
    const errs = validatePreChatValues(preChatFields, preValues);
    setPreErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setPreBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/live-chat/pre-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Visitor-Token': visitorToken,
        },
        body: JSON.stringify(preValues),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.details && typeof data.details === 'object') setPreErrors(data.details);
        setError(data.message || 'خطا در ثبت اطلاعات');
        return;
      }
      setVisitor(data.visitor);
      setPreChatSubmitted(true);
      localStorage.setItem(STORAGE_PRECHAT, '1');
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch {
      setError('ارتباط با سرور برقرار نشد.');
    } finally {
      setPreBusy(false);
    }
  };

  const notifyTyping = useCallback(
    (text: string) => {
      if (!visitorToken || !conversation) return;
      const now = Date.now();
      if (now - lastTypingSentRef.current < 1200 && text.trim().length > 0) return;
      lastTypingSentRef.current = now;
      void fetch('/api/live-chat/typing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Visitor-Token': visitorToken,
        },
        body: JSON.stringify({ isTyping: text.trim().length > 0, preview: text.slice(0, 120) }),
      }).catch(() => {});
    },
    [visitorToken, conversation],
  );

  const sendText = async () => {
    const body = draft.trim();
    if (!body || sending || !visitorToken) return;
    setSending(true);
    setError(null);
    setDraft('');
    notifyTyping('');
    try {
      const res = await fetch('/api/live-chat/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Visitor-Token': visitorToken,
        },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setDraft(body);
        setError(data.message || 'ارسال پیام ناموفق بود.');
        return;
      }
      if (data.conversation) setConversation(data.conversation);
      if (data.message) {
        setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      }
    } catch {
      setDraft(body);
      setError('خطا در ارسال پیام. لطفاً مجدداً تلاش کنید.');
    } finally {
      setSending(false);
    }
  };

  const sendFile = async (file: File, voice = false) => {
    if (!visitorToken || sending) return;
    setSending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (voice) fd.append('voice', '1');
      const res = await fetch('/api/live-chat/messages', {
        method: 'POST',
        headers: { 'X-Visitor-Token': visitorToken },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message || 'آپلود فایل ناموفق بود.');
        return;
      }
      if (data.conversation) setConversation(data.conversation);
      if (data.message) {
        setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      }
    } catch {
      setError('خطا در ارسال فایل.');
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('مرورگر شما از ضبط پیام صوتی پشتیبانی نمی‌کند.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      let sec = 0;
      setRecordingSec(0);
      const timer = setInterval(() => {
        sec += 1;
        setRecordingSec(sec);
      }, 1000);

      const handle = { recorder, chunks, timer, cancelled: false };
      recorderRef.current = handle;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        setRecordingSec(null);
        recorderRef.current = null;
        if (handle.cancelled || !chunks.length) return;
        const actualMime = (recorder.mimeType || 'audio/webm').split(';')[0] ?? 'audio/webm';
        const ext = actualMime.includes('ogg') ? 'ogg' : 'webm';
        const file = new File(chunks, `voice-${Date.now()}.${ext}`, { type: actualMime });
        void sendFile(file, true);
      };
      recorder.start();
    } catch {
      setError('دسترسی به میکروفون داده نشد.');
    }
  };

  const stopRecording = (cancel: boolean) => {
    const h = recorderRef.current;
    if (!h) return;
    h.cancelled = cancel;
    h.recorder.stop();
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendText();
    }
  };

  if (isAdminRoute || !ready || !settings?.enabled) return null;

  const isRight = settings.position === 'bottom_right';

  return (
    <>
      {!isOpen && (
        <div className={`${s.root} ${isRight ? s.right : s.left}`} data-live-chat-root>
          <button
            type="button"
            className={s.fab}
            onClick={() => setIsOpen(true)}
            aria-label={settings.widgetTitle}
            data-live-chat-launcher
          >
            <span className={s.fabIcon}>
              <Icon name="support_agent" size={20} />
            </span>
            <span className={s.fabLabel}>پشتیبانی آنلاین</span>
            <span
              className={`${s.fabStatusDot} ${operatorOnline ? s.fabStatusOnline : ''}`}
              aria-hidden="true"
            />
            {unread > 0 && <span className={s.fabUnread}>{toFaDigits(unread)}</span>}
          </button>
        </div>
      )}

      {isOpen && (
        <section
          className={`${s.panel} ${isRight ? s.panelRight : s.panelLeft}`}
          role="dialog"
          aria-label={settings.widgetTitle}
          data-live-chat-panel
        >
          <header className={s.head}>
            <div className={s.headAvatar} aria-hidden="true">
              <Icon name="support_agent" size={22} />
            </div>
            <div className={s.headInfo}>
              <p className={s.headTitle}>{settings.widgetTitle}</p>
              <p className={s.headSub}>
                <span className={`${s.statusDot} ${operatorOnline ? s.statusDotOn : ''}`} />
                {operatorOnline ? 'پشتیبان آنلاین و آماده پاسخ‌گویی' : 'پیام بگذارید؛ پاسخ می‌دهیم'}
              </p>
            </div>
            <button
              type="button"
              className={s.headClose}
              onClick={() => setIsOpen(false)}
              aria-label="بستن پنجره گفتگو"
              data-live-chat-close
            >
              <Icon name="close" size={20} />
            </button>
          </header>

          {error && (
            <div className={s.errBar} role="alert">
              <span>{error}</span>
              <button type="button" className={s.errClose} onClick={() => setError(null)} aria-label="بستن خطا">
                ✕
              </button>
            </div>
          )}

          {showPreChat ? (
            <div className={s.preChatWrap} data-live-chat-prechat>
              <div className={s.welcomeBox}>
                {operatorOnline ? settings.welcomeMessage : settings.offlineMessage || settings.welcomeMessage}
              </div>
              <p className={s.preChatIntro}>برای شروع گفتگو و پیگیری سریع‌تر، اطلاعات زیر را وارد کنید:</p>
              <form className={s.preChatForm} onSubmit={submitPreChat} noValidate>
                {enabledFields.map((field) => {
                  const isLtr = field.key === 'mobile' || field.key === 'email';
                  return (
                    <div key={field.key} className={s.fieldGroup}>
                      <label className={s.fieldLabel} htmlFor={`avina-lc-${field.key}`}>
                        {PRECHAT_FIELD_LABEL[field.key]}
                        {field.required && <span className={s.reqStar}>*</span>}
                      </label>
                      <input
                        id={`avina-lc-${field.key}`}
                        name={field.key}
                        type={field.key === 'email' ? 'email' : field.key === 'mobile' ? 'tel' : 'text'}
                        inputMode={field.key === 'mobile' ? 'numeric' : undefined}
                        className={`${s.fieldInput} ${isLtr ? s.fieldInputLtr : ''}`}
                        placeholder={PRECHAT_FIELD_PLACEHOLDER[field.key]}
                        value={preValues[field.key] ?? ''}
                        onChange={(e) => {
                          setPreValues((prev) => ({ ...prev, [field.key]: e.target.value }));
                          setPreErrors((prev) => ({ ...prev, [field.key]: undefined }));
                        }}
                        required={field.required}
                      />
                      {preErrors[field.key] && <span className={s.fieldErr}>{preErrors[field.key]}</span>}
                    </div>
                  );
                })}
                <button type="submit" className={s.preChatBtn} disabled={preBusy}>
                  {preBusy ? 'در حال ثبت...' : 'شروع گفتگو'}
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className={s.messages} ref={scrollerRef} data-live-chat-messages>
                <div className={s.welcomeBox}>
                  {operatorOnline ? settings.welcomeMessage : settings.offlineMessage || settings.welcomeMessage}
                </div>

                {messages.map((m) => {
                  const isVisitor = m.senderType === 'visitor';
                  return (
                    <div
                      key={m.id}
                      className={`${s.bubbleRow} ${isVisitor ? s.rowVisitor : s.rowOperator}`}
                      data-chat-message-sender={m.senderType}
                    >
                      {!isVisitor && m.senderName && <span className={s.senderLabel}>{m.senderName}</span>}
                      <div className={`${s.bubble} ${isVisitor ? s.bubbleVisitor : s.bubbleOperator}`}>
                        {m.type === 'image' && m.attachmentUrl && (
                          <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={m.attachmentUrl} alt={m.attachmentName || 'تصویر پیوست'} className={s.msgImg} />
                          </a>
                        )}
                        {m.type === 'audio' && m.attachmentUrl && (
                          <audio controls preload="metadata" src={m.attachmentUrl} className={s.audioPlayer} />
                        )}
                        {m.type === 'file' && m.attachmentUrl && (
                          <a
                            href={m.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={s.fileCard}
                          >
                            <span>📎</span>
                            <span>{m.attachmentName || 'فایل پیوست'}</span>
                            {m.attachmentSize ? <span>({formatFileSize(m.attachmentSize)})</span> : null}
                          </a>
                        )}
                        {m.body && <MessageText text={m.body} />}
                      </div>
                      <div className={s.meta}>
                        <span>{fmtTime(m.createdAt)}</span>
                        {m.editedAt && <span>• ویرایش‌شده</span>}
                        {isVisitor && (
                          <span className={m.readAt ? s.ticksRead : undefined} title={m.readAt ? 'خوانده شد' : 'ارسال شد'}>
                            {m.readAt ? '✓✓' : '✓'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {operatorTyping && (
                  <div className={s.typingRow}>
                    <span className={s.dots} aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    <span>{operatorTyping} در حال نوشتن...</span>
                  </div>
                )}

                {conversation?.status === 'closed' && (
                  <div className={s.closedNote}>
                    این گفتگو بسته شده است. با ارسال پیام جدید، گفتگو مجدداً باز می‌شود.
                  </div>
                )}
              </div>

              <div className={s.composer}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,audio/*,.pdf,.txt,.zip"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void sendFile(f, false);
                  }}
                />

                {recordingSec !== null ? (
                  <div className={s.recBar}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span className={s.recDot} />
                      <span>در حال ضبط: {toFaDigits(recordingSec)} ثانیه</span>
                    </span>
                    <div className={s.recActions}>
                      <button type="button" className={s.recCancel} onClick={() => stopRecording(true)}>
                        لغو
                      </button>
                      <button type="button" className={s.recSend} onClick={() => stopRecording(false)}>
                        ارسال
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className={s.toolBtn}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending}
                      aria-label="ارسال فایل یا تصویر"
                      title="ارسال فایل یا تصویر"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className={s.toolBtn}
                      onClick={() => void startRecording()}
                      disabled={sending}
                      aria-label="ضبط پیام صوتی"
                      title="ضبط پیام صوتی"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8" />
                      </svg>
                    </button>

                    <textarea
                      ref={inputRef}
                      rows={1}
                      className={s.textarea}
                      placeholder="پیام خود را بنویسید..."
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        notifyTyping(e.target.value);
                      }}
                      onKeyDown={onComposerKeyDown}
                      disabled={sending}
                      data-live-chat-input
                    />

                    <button
                      type="button"
                      className={s.sendBtn}
                      onClick={() => void sendText()}
                      disabled={sending || !draft.trim()}
                      aria-label="ارسال پیام"
                      data-live-chat-send
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style={{ transform: 'scaleX(-1)' }}>
                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
