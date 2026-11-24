'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { playChatChime } from '@/lib/live-chat/sound';
import {
  formatFileSize,
  linkifyParts,
  type ChatCannedResponseDTO,
  type ChatConversationStatus,
  type ChatConversationSummary,
  type ChatEventEnvelope,
  type ChatMessageDTO,
  type ChatOperatorDTO,
  type ChatOperatorPresence,
  type ChatPageViewDTO,
  type ChatPreChatField,
  type ChatVisitorPublic,
  type ChatWidgetSettings,
} from '@/lib/live-chat/types';
import { Alert, Icon } from '@/ui';
import { CannedTab } from './CannedTab';
import { SettingsTab } from './SettingsTab';
import s from './live-chat-panel.module.css';

export type AdminLiveChatBootstrap = {
  currentOperator: {
    id: string;
    name: string;
    isAdmin: boolean;
    status: ChatOperatorPresence;
  };
  counts: { pending: number; open: number; closed: number; unreadTotal: number };
  conversations: ChatConversationSummary[];
  operators: ChatOperatorDTO[];
  cannedResponses: ChatCannedResponseDTO[];
  onlineVisitors: ChatVisitorPublic[];
  settings: ChatWidgetSettings;
  preChatFields: ChatPreChatField[];
};

type WorkspaceTab = 'inbox' | 'visitors' | 'canned' | 'settings';
type OrderSummary = { number: string; status: string; totalToman: number; createdAt: string };

const timeFa = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });
const dateShortFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function fmtTime(iso: string): string {
  try {
    return timeFa.format(new Date(iso));
  } catch {
    return '';
  }
}

function fmtShortDate(iso: string): string {
  try {
    return dateShortFa.format(new Date(iso));
  } catch {
    return '';
  }
}

function visitorDisplayName(v: ChatVisitorPublic): string {
  return v.name?.trim() || (v.mobile ? toFaDigits(v.mobile) : '') || v.email || `بازدیدکننده #${toFaDigits(v.id)}`;
}

function initials(name: string): string {
  const clean = name.trim();
  return clean ? clean.slice(0, 2) : '؟';
}

function statusLabel(st: ChatConversationStatus): string {
  if (st === 'pending') return 'در انتظار';
  if (st === 'open') return 'در حال گفتگو';
  return 'بسته‌شده';
}

function SafeBody({ text }: { text: string }) {
  const parts = useMemo(() => linkifyParts(text), [text]);
  return (
    <>
      {parts.map((p, idx) =>
        p.kind === 'link' ? (
          <a key={idx} href={p.href} target="_blank" rel="noopener noreferrer nofollow" style={{ textDecoration: 'underline', color: 'inherit' }}>
            {p.value}
          </a>
        ) : (
          <span key={idx}>{p.value}</span>
        ),
      )}
    </>
  );
}

export function LiveChatPanel({ initial }: { initial: AdminLiveChatBootstrap }) {
  const [tab, setTab] = useState<WorkspaceTab>('inbox');
  const [presence, setPresence] = useState<ChatOperatorPresence>(initial.currentOperator.status);
  const [soundOn, setSoundOn] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<ChatConversationSummary[]>(initial.conversations);
  const [operators, setOperators] = useState<ChatOperatorDTO[]>(initial.operators);
  const [canned, setCanned] = useState<ChatCannedResponseDTO[]>(initial.cannedResponses);
  const [onlineVisitors, setOnlineVisitors] = useState<ChatVisitorPublic[]>(initial.onlineVisitors);
  const [settings, setSettings] = useState<ChatWidgetSettings>(initial.settings);
  const [preChatFields, setPreChatFields] = useState<ChatPreChatField[]>(initial.preChatFields);

  // Inbox filter + active conversation
  const [statusFilter, setStatusFilter] = useState<ChatConversationStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(initial.conversations[0]?.id ?? null);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [mobileVisitorDrawer, setMobileVisitorDrawer] = useState(false);

  // Active thread state
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [pageViews, setPageViews] = useState<ChatPageViewDTO[]>([]);
  const [recentOrders, setRecentOrders] = useState<OrderSummary[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [visitorTyping, setVisitorTyping] = useState<{ active: boolean; preview: string }>({ active: false, preview: '' });

  // Composer + inline edit + recording
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [recordingSec, setRecordingSec] = useState<number | null>(null);
  const [cannedOpenManual, setCannedOpenManual] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeIdRef = useRef<string | null>(activeId);
  const soundOnRef = useRef(soundOn);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOpTypingRef = useRef(0);
  const recorderRef = useRef<{
    recorder: MediaRecorder;
    chunks: Blob[];
    timer: ReturnType<typeof setInterval>;
    cancelled: boolean;
  } | null>(null);

  activeIdRef.current = activeId;
  soundOnRef.current = soundOn;

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const counts = useMemo(() => {
    let pending = 0;
    let open = 0;
    let closed = 0;
    let unreadTotal = 0;
    for (const c of conversations) {
      if (c.status === 'pending') pending += 1;
      else if (c.status === 'open') open += 1;
      else closed += 1;
      if (c.status !== 'closed') unreadTotal += c.unreadForOperator;
    }
    return { pending, open, closed, unreadTotal };
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${c.visitor.name ?? ''} ${c.visitor.mobile ?? ''} ${c.visitor.email ?? ''} ${c.lastMessagePreview ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [conversations, statusFilter, search]);

  // Slash canned-response autocomplete matches
  const slashQuery = draft.startsWith('/') ? draft.slice(1).trim().toLowerCase() : null;
  const cannedMatches = useMemo(() => {
    if (slashQuery === null && !cannedOpenManual) return [];
    const q = slashQuery ?? '';
    return canned.filter(
      (c) => !q || c.shortcut.toLowerCase().includes(q) || c.title.toLowerCase().includes(q),
    );
  }, [slashQuery, cannedOpenManual, canned]);

  const scrollThreadBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }, []);

  const loadConversation = useCallback(
    async (id: string) => {
      setLoadingThread(true);
      setError(null);
      setVisitorTyping({ active: false, preview: '' });
      try {
        const res = await fetch(`/api/admin/live-chat/conversations/${id}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.message || 'خطا در بارگذاری گفتگو.');
          return;
        }
        setMessages(data.messages ?? []);
        setPageViews(data.pageViews ?? []);
        setRecentOrders(data.recentOrders ?? []);
        if (data.conversation) {
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...data.conversation, unreadForOperator: 0 } : c)),
          );
        }
        // Mark visitor messages as read
        void fetch(`/api/admin/live-chat/conversations/${id}/read`, { method: 'POST' }).catch(() => {});
        scrollThreadBottom(false);
      } catch {
        setError('ارتباط با سرور برقرار نشد.');
      } finally {
        setLoadingThread(false);
      }
    },
    [scrollThreadBottom],
  );

  // Load initial active conversation
  useEffect(() => {
    if (activeId) void loadConversation(activeId);
  }, [activeId, loadConversation]);

  useEffect(() => {
    scrollThreadBottom(true);
  }, [messages.length, visitorTyping.active, scrollThreadBottom]);

  // Upsert a conversation into list sorted by lastMessageAt DESC
  const upsertConversation = useCallback((summary: ChatConversationSummary) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== summary.id);
      next.push(summary);
      next.sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
      return next;
    });
  }, []);

  // Subscribe to Staff SSE Stream
  useEffect(() => {
    const es = new EventSource('/api/admin/live-chat/stream');

    const onMessageSent = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const conv = env.payload.conversation as ChatConversationSummary | undefined;
        const msg = env.payload.message as ChatMessageDTO | undefined;

        if (conv) {
          const isCurrent = conv.id === activeIdRef.current;
          upsertConversation(isCurrent ? { ...conv, unreadForOperator: 0 } : conv);
          if (!activeIdRef.current) setActiveId(conv.id);
        }

        if (msg) {
          if (msg.conversationId === activeIdRef.current) {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            if (msg.senderType === 'visitor') {
              setVisitorTyping({ active: false, preview: '' });
              void fetch(`/api/admin/live-chat/conversations/${msg.conversationId}/read`, { method: 'POST' }).catch(() => {});
            }
          }
          if (msg.senderType === 'visitor' && soundOnRef.current) {
            playChatChime('operator');
          }
        }
      } catch {
        // ignore
      }
    };

    const onMessageEdited = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const msg = env.payload.message as ChatMessageDTO | undefined;
        if (msg && msg.conversationId === activeIdRef.current) {
          setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
        }
      } catch {
        // ignore
      }
    };

    const onRead = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const convId = env.payload.conversationId as string | undefined;
        const reader = env.payload.reader as string | undefined;
        const readAt = (env.payload.readAt as string) || new Date().toISOString();
        if (convId && convId === activeIdRef.current && reader === 'visitor') {
          setMessages((prev) =>
            prev.map((m) => (m.senderType === 'operator' && !m.readAt ? { ...m, readAt } : m)),
          );
        }
      } catch {
        // ignore
      }
    };

    const onTyping = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        if (env.payload.senderType !== 'visitor') return;
        if (env.payload.conversationId !== activeIdRef.current) return;
        const active = Boolean(env.payload.isTyping);
        const preview = typeof env.payload.preview === 'string' ? env.payload.preview : '';
        setVisitorTyping({ active, preview });
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        if (active) {
          typingTimerRef.current = setTimeout(() => setVisitorTyping({ active: false, preview: '' }), 5000);
        }
      } catch {
        // ignore
      }
    };

    const onConvEvent = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const conv = env.payload.conversation as ChatConversationSummary | undefined;
        const sysMsg = env.payload.message as ChatMessageDTO | undefined;
        if (conv) upsertConversation(conv);
        if (sysMsg && sysMsg.conversationId === activeIdRef.current) {
          setMessages((prev) => (prev.some((m) => m.id === sysMsg.id) ? prev : [...prev, sysMsg]));
        }
        if (
          env.event === 'conversation.assigned' &&
          env.payload.toUserId === initial.currentOperator.id &&
          env.payload.byUserId !== initial.currentOperator.id &&
          soundOnRef.current
        ) {
          playChatChime('operator');
        }
      } catch {
        // ignore
      }
    };

    const onVisitorSeen = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const v = env.payload.visitor as ChatVisitorPublic | undefined;
        if (!v) return;
        setOnlineVisitors((prev) => {
          const rest = prev.filter((item) => item.id !== v.id);
          return [v, ...rest];
        });
        setConversations((prev) => prev.map((c) => (c.visitor.id === v.id ? { ...c, visitor: v } : c)));
      } catch {
        // ignore
      }
    };

    const onOpStatus = (ev: MessageEvent) => {
      try {
        const env = JSON.parse(ev.data) as ChatEventEnvelope;
        const userId = env.payload.userId as string | undefined;
        const status = env.payload.status as ChatOperatorPresence | undefined;
        if (userId && status) {
          setOperators((prev) => prev.map((o) => (o.id === userId ? { ...o, status } : o)));
        }
      } catch {
        // ignore
      }
    };

    es.addEventListener('message.sent', onMessageSent);
    es.addEventListener('message.edited', onMessageEdited);
    es.addEventListener('message.read', onRead);
    es.addEventListener('typing', onTyping);
    es.addEventListener('conversation.assigned', onConvEvent);
    es.addEventListener('conversation.closed', onConvEvent);
    es.addEventListener('conversation.reopened', onConvEvent);
    es.addEventListener('visitor.seen', onVisitorSeen);
    es.addEventListener('operator.status', onOpStatus);

    return () => {
      es.close();
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [initial.currentOperator.id, upsertConversation]);

  // Actions
  const changePresence = async (next: ChatOperatorPresence) => {
    setPresence(next);
    await fetch('/api/admin/live-chat/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    }).catch(() => {});
  };

  const notifyOperatorTyping = (text: string) => {
    if (!activeId) return;
    const now = Date.now();
    if (now - lastOpTypingRef.current < 1200 && text.trim().length > 0) return;
    lastOpTypingRef.current = now;
    void fetch(`/api/admin/live-chat/conversations/${activeId}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTyping: text.trim().length > 0 }),
    }).catch(() => {});
  };

  const sendMessage = async () => {
    const body = draft.trim();
    if (!activeId || !body || sending) return;
    setSending(true);
    setError(null);
    setDraft('');
    setCannedOpenManual(false);
    notifyOperatorTyping('');
    try {
      const res = await fetch(`/api/admin/live-chat/conversations/${activeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setDraft(body);
        setError(data.message || 'ارسال پاسخ ناموفق بود.');
        return;
      }
      if (data.conversation) upsertConversation(data.conversation);
      setMessages((prev) => {
        const next = [...prev];
        if (data.systemMessage && !next.some((m) => m.id === data.systemMessage.id)) next.push(data.systemMessage);
        if (data.message && !next.some((m) => m.id === data.message.id)) next.push(data.message);
        return next;
      });
    } catch {
      setDraft(body);
      setError('خطا در ارسال پیام.');
    } finally {
      setSending(false);
    }
  };

  const sendFile = async (file: File, voice = false) => {
    if (!activeId || sending) return;
    setSending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (voice) fd.append('voice', '1');
      const res = await fetch(`/api/admin/live-chat/conversations/${activeId}/messages`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message || 'آپلود فایل ناموفق بود.');
        return;
      }
      if (data.conversation) upsertConversation(data.conversation);
      setMessages((prev) => {
        const next = [...prev];
        if (data.systemMessage && !next.some((m) => m.id === data.systemMessage.id)) next.push(data.systemMessage);
        if (data.message && !next.some((m) => m.id === data.message.id)) next.push(data.message);
        return next;
      });
    } catch {
      setError('خطا در ارسال فایل.');
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('مرورگر از ضبط پیام صوتی پشتیبانی نمی‌کند.');
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

  const saveEdit = async () => {
    if (!editingMsgId || !editingText.trim()) return;
    setError(null);
    const res = await fetch(`/api/admin/live-chat/messages/${editingMsgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: editingText }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.message || 'ویرایش پیام انجام نشد.');
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === editingMsgId ? data.message : m)));
    setEditingMsgId(null);
    setEditingText('');
  };

  const transferTo = async (targetUserId: string) => {
    if (!activeId || !targetUserId) return;
    setError(null);
    const res = await fetch(`/api/admin/live-chat/conversations/${activeId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.message || 'انتقال گفتگو انجام نشد.');
      return;
    }
    if (data.conversation) upsertConversation(data.conversation);
    if (data.systemMessage) {
      setMessages((prev) => (prev.some((m) => m.id === data.systemMessage.id) ? prev : [...prev, data.systemMessage]));
    }
  };

  const toggleCloseStatus = async () => {
    if (!activeConv) return;
    const nextStatus = activeConv.status === 'closed' ? 'open' : 'closed';
    setError(null);
    const res = await fetch(`/api/admin/live-chat/conversations/${activeConv.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.message || 'تغییر وضعیت گفتگو ناموفق بود.');
      return;
    }
    if (data.conversation) upsertConversation(data.conversation);
    if (data.systemMessage) {
      setMessages((prev) => (prev.some((m) => m.id === data.systemMessage.id) ? prev : [...prev, data.systemMessage]));
    }
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className={s.shell} data-admin-live-chat>
      {/* Top Bar */}
      <div className={s.topBar}>
        <div className={s.topTitleWrap}>
          <h1 className={s.topTitle}>
            <Icon name="support_agent" size={24} />
            پشتیبانی آنلاین مشتریان
          </h1>
          <p className={s.topSub}>
            پاسخ‌گویی زنده، مشاهده صفحه فعلی مشتریان، پاسخ‌های آماده (/)، انتقال گفتگو و تنظیم فرم پیش از چت
          </p>
        </div>

        <div className={s.topControls}>
          <div className={s.presenceGroup} role="group" aria-label="وضعیت آنلاین پشتیبان">
            {([
              ['online', 'آنلاین', s.dotOnline],
              ['away', 'غیرفعال موقت', s.dotAway],
              ['offline', 'آفلاین', s.dotOffline],
            ] as const).map(([key, label, dotClass]) => (
              <button
                key={key}
                type="button"
                className={`${s.presenceBtn} ${presence === key ? s.presenceActive : ''}`}
                onClick={() => void changePresence(key)}
              >
                <span className={`${s.dot} ${dotClass}`} />
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`${s.soundBtn} ${soundOn ? s.soundBtnActive : ''}`}
            onClick={() => setSoundOn((v) => !v)}
          >
            {soundOn ? '🔔 صدای اعلان روشن' : '🔕 صدای اعلان خاموش'}
          </button>
        </div>
      </div>

      {/* Main Workspace Tabs */}
      <div className={s.navTabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'inbox'}
          className={`${s.navTab} ${tab === 'inbox' ? s.navTabActive : ''}`}
          onClick={() => setTab('inbox')}
          data-lc-tab="inbox"
        >
          صندوق گفتگوها
          {counts.unreadTotal + counts.pending > 0 && (
            <span className={s.tabBadge}>{toFaDigits(counts.unreadTotal || counts.pending)}</span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'visitors'}
          className={`${s.navTab} ${tab === 'visitors' ? s.navTabActive : ''}`}
          onClick={() => setTab('visitors')}
          data-lc-tab="visitors"
        >
          بازدیدکنندگان آنلاین ({toFaDigits(onlineVisitors.length)})
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'canned'}
          className={`${s.navTab} ${tab === 'canned' ? s.navTabActive : ''}`}
          onClick={() => setTab('canned')}
          data-lc-tab="canned"
        >
          پاسخ‌های آماده ({toFaDigits(canned.length)})
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'settings'}
          className={`${s.navTab} ${tab === 'settings' ? s.navTabActive : ''}`}
          onClick={() => setTab('settings')}
          data-lc-tab="settings"
        >
          تنظیمات و فرم پیش از چت
        </button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {/* TAB 1: LIVE INBOX */}
      {tab === 'inbox' && (
        <div className={s.inboxGrid}>
          {/* Column 1: Conversations list */}
          <aside className={`${s.pane} ${mobileShowThread ? s.hideMobile : ''}`} data-lc-conv-list>
            <div className={s.listHead}>
              <input
                type="search"
                className={s.searchInput}
                placeholder="جستجوی نام، موبایل یا متن..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className={s.filterRow}>
                {([
                  ['all', `همه (${toFaDigits(conversations.length)})`],
                  ['pending', `در انتظار (${toFaDigits(counts.pending)})`],
                  ['open', `باز (${toFaDigits(counts.open)})`],
                  ['closed', `بسته (${toFaDigits(counts.closed)})`],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`${s.filterChip} ${statusFilter === key ? s.filterChipActive : ''}`}
                    onClick={() => setStatusFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className={s.convList}>
              {filteredConversations.length === 0 ? (
                <div className={s.emptyState}>
                  <Icon name="sms" size={32} />
                  <span>گفتگویی در این بخش وجود ندارد.</span>
                </div>
              ) : (
                filteredConversations.map((c) => {
                  const name = visitorDisplayName(c.visitor);
                  const preview =
                    c.lastMessagePreview ||
                    (c.lastMessageType === 'image'
                      ? '📷 تصویر'
                      : c.lastMessageType === 'audio'
                        ? '🎤 پیام صوتی'
                        : c.lastMessageType === 'file'
                          ? '📎 فایل پیوست'
                          : 'بدون پیام');
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`${s.convItem} ${c.id === activeId ? s.convItemActive : ''}`}
                      onClick={() => {
                        setActiveId(c.id);
                        setMobileShowThread(true);
                      }}
                      data-lc-conv-item={c.id}
                    >
                      <div className={s.avatar}>
                        {initials(name)}
                        {c.visitor.online && <span className={s.avatarOnline} title="آنلاین" />}
                      </div>
                      <div className={s.convBody}>
                        <div className={s.convTop}>
                          <span className={s.convName}>{name}</span>
                          <span className={s.convTime}>{fmtTime(c.lastMessageAt)}</span>
                        </div>
                        <span className={s.convPreview}>{preview}</span>
                        <div className={s.convFoot}>
                          <span
                            className={`${s.statusPill} ${
                              c.status === 'pending'
                                ? s.statusPending
                                : c.status === 'open'
                                  ? s.statusOpen
                                  : s.statusClosed
                            }`}
                          >
                            {statusLabel(c.status)}
                            {c.assignedUserName ? ` · ${c.assignedUserName}` : ''}
                          </span>
                          {c.unreadForOperator > 0 && (
                            <span className={s.unreadPill}>{toFaDigits(c.unreadForOperator)}</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Column 2: Chat Thread */}
          <section className={`${s.pane} ${!mobileShowThread && conversations.length > 0 ? s.hideMobile : ''}`}>
            {!activeConv ? (
              <div className={s.emptyState}>
                <Icon name="support_agent" size={40} />
                <strong>یک گفتگو را از فهرست انتخاب کنید</strong>
                <span>پیام‌های جدید مشتریان به‌صورت لحظه‌ای در اینجا ظاهر می‌شوند.</span>
              </div>
            ) : (
              <>
                <header className={s.chatHead}>
                  <div className={s.chatHeadLeft}>
                    <button
                      type="button"
                      className={s.mobileBackBtn}
                      onClick={() => setMobileShowThread(false)}
                      aria-label="بازگشت به فهرست گفتگوها"
                    >
                      <Icon name="arrow_forward" size={18} />
                    </button>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14.5 }}>{visitorDisplayName(activeConv.visitor)}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>
                        {activeConv.visitor.online ? '🟢 آنلاین در فروشگاه' : '⚪ آفلاین'}
                        {activeConv.assignedUserName ? ` · مسئول: ${activeConv.assignedUserName}` : ' · بدون مسئول'}
                      </div>
                    </div>
                  </div>

                  <div className={s.chatHeadActions}>
                    {activeConv.status !== 'closed' && (
                      <select
                        className={s.transferSelect}
                        value=""
                        aria-label="انتقال گفتگو به اپراتور دیگر"
                        onChange={(e) => {
                          if (e.target.value) void transferTo(e.target.value);
                        }}
                        data-lc-transfer
                      >
                        <option value="">انتقال / تخصیص گفتگو...</option>
                        {operators
                          .filter((op) => op.id !== activeConv.assignedUserId)
                          .map((op) => (
                            <option key={op.id} value={op.id}>
                              {op.status === 'online' ? '🟢 ' : op.status === 'away' ? '🟡 ' : '⚪ '}
                              {op.name}
                            </option>
                          ))}
                      </select>
                    )}

                    <button
                      type="button"
                      className={s.actionBtn}
                      onClick={() => void toggleCloseStatus()}
                      data-lc-toggle-status
                    >
                      {activeConv.status === 'closed' ? 'بازگشایی گفتگو' : 'بستن گفتگو'}
                    </button>

                    <button
                      type="button"
                      className={`${s.actionBtn} ${s.infoToggleBtn}`}
                      onClick={() => setMobileVisitorDrawer((v) => !v)}
                    >
                      اطلاعات مشتری
                    </button>
                  </div>
                </header>

                <div className={s.chatMessages} ref={scrollerRef} data-lc-thread>
                  {loadingThread ? (
                    <div className={s.emptyState}>در حال بارگذاری پیام‌ها...</div>
                  ) : (
                    messages.map((m) => {
                      if (m.senderType === 'system') {
                        return (
                          <div key={m.id} className={s.sysNote} data-lc-system-note>
                            {m.body}
                          </div>
                        );
                      }

                      const isVisitor = m.senderType === 'visitor';
                      const isMe = m.senderType === 'operator' && m.senderUserId === initial.currentOperator.id;
                      const canEdit =
                        m.senderType === 'operator' &&
                        m.type === 'text' &&
                        (isMe || initial.currentOperator.isAdmin);

                      return (
                        <div
                          key={m.id}
                          className={`${s.msgRow} ${
                            isVisitor ? s.msgRowVisitor : isMe ? s.msgRowMe : s.msgRowOtherOp
                          }`}
                        >
                          {!isVisitor && !isMe && m.senderName && (
                            <span className={s.msgSender}>{m.senderName}</span>
                          )}
                          <div
                            className={`${s.msgBubble} ${
                              isVisitor ? s.bubbleVisitor : isMe ? s.bubbleMe : s.bubbleOtherOp
                            }`}
                          >
                            {m.type === 'image' && m.attachmentUrl && (
                              <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={m.attachmentUrl} alt={m.attachmentName || 'تصویر'} className={s.msgImg} />
                              </a>
                            )}
                            {m.type === 'audio' && m.attachmentUrl && (
                              <audio controls preload="metadata" src={m.attachmentUrl} style={{ maxWidth: 230, height: 36 }} />
                            )}
                            {m.type === 'file' && m.attachmentUrl && (
                              <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer" className={s.msgFile}>
                                <span>📎</span>
                                <span>{m.attachmentName || 'فایل پیوست'}</span>
                                {m.attachmentSize ? <span>({formatFileSize(m.attachmentSize)})</span> : null}
                              </a>
                            )}

                            {editingMsgId === m.id ? (
                              <div className={s.inlineEditBox}>
                                <input
                                  className={s.inlineEditInput}
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void saveEdit();
                                    if (e.key === 'Escape') setEditingMsgId(null);
                                  }}
                                  autoFocus
                                />
                                <div className={s.inlineEditBtns}>
                                  <button type="button" className={s.miniBtn} onClick={() => void saveEdit()}>
                                    ذخیره
                                  </button>
                                  <button type="button" className={s.miniBtn} onClick={() => setEditingMsgId(null)}>
                                    لغو
                                  </button>
                                </div>
                              </div>
                            ) : (
                              m.body && <SafeBody text={m.body} />
                            )}
                          </div>

                          <div className={s.msgMeta}>
                            <span>{fmtTime(m.createdAt)}</span>
                            {m.editedAt && <span>• ویرایش‌شده</span>}
                            {!isVisitor && <span>{m.readAt ? '✓✓' : '✓'}</span>}
                            {canEdit && editingMsgId !== m.id && (
                              <button
                                type="button"
                                className={s.editLink}
                                onClick={() => {
                                  setEditingMsgId(m.id);
                                  setEditingText(m.body ?? '');
                                }}
                              >
                                ویرایش
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {visitorTyping.active && (
                    <div className={s.visitorTyping}>
                      مشتری در حال نوشتن است...
                      {visitorTyping.preview ? ` «${visitorTyping.preview}»` : ''}
                    </div>
                  )}
                </div>

                {/* Composer */}
                <div className={s.composerWrap}>
                  {cannedMatches.length > 0 && (
                    <div className={s.cannedPopup} data-lc-canned-popup>
                      {cannedMatches.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={s.cannedOption}
                          onClick={() => {
                            setDraft(item.body);
                            setCannedOpenManual(false);
                          }}
                        >
                          <span className={s.cannedShortcut}>/{item.shortcut} — {item.title}</span>
                          <span className={s.cannedText}>{item.body}</span>
                        </button>
                      ))}
                    </div>
                  )}

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

                  {activeConv.status === 'closed' ? (
                    <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--color-muted)', padding: '6px 0' }}>
                      این گفتگو بسته شده است. برای ارسال پاسخ جدید، دکمه «بازگشایی گفتگو» را بزنید.
                    </div>
                  ) : recordingSec !== null ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <strong style={{ color: 'var(--color-danger)', fontSize: 13 }}>
                        🔴 در حال ضبط پیام صوتی: {toFaDigits(recordingSec)} ثانیه
                      </strong>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className={s.actionBtn} onClick={() => stopRecording(true)}>
                          لغو
                        </button>
                        <button type="button" className={s.sendBtn} onClick={() => stopRecording(false)}>
                          ارسال صدا
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={s.composerRow}>
                      <button
                        type="button"
                        className={s.toolBtn}
                        title="پاسخ‌های آماده (/)"
                        onClick={() => setCannedOpenManual((v) => !v)}
                        data-lc-canned-btn
                      >
                        /
                      </button>

                      <button
                        type="button"
                        className={s.toolBtn}
                        title="ارسال فایل یا تصویر"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={sending}
                      >
                        📎
                      </button>

                      <button
                        type="button"
                        className={s.toolBtn}
                        title="ضبط پیام صوتی"
                        onClick={() => void startRecording()}
                        disabled={sending}
                      >
                        🎤
                      </button>

                      <textarea
                        rows={1}
                        className={s.composerInput}
                        placeholder="پاسخ خود را بنویسید... (برای پاسخ آماده / بزنید)"
                        value={draft}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          notifyOperatorTyping(e.target.value);
                        }}
                        onKeyDown={onComposerKeyDown}
                        disabled={sending}
                        data-lc-operator-input
                      />

                      <button
                        type="button"
                        className={s.sendBtn}
                        onClick={() => void sendMessage()}
                        disabled={sending || !draft.trim()}
                        data-lc-operator-send
                      >
                        ارسال
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          {/* Column 3: Visitor Info Sidebar */}
          <aside
            className={`${s.pane} ${s.visitorPane} ${mobileVisitorDrawer ? s.visitorPaneOpen : ''}`}
            onClick={(e) => {
              if (mobileVisitorDrawer && e.target === e.currentTarget) setMobileVisitorDrawer(false);
            }}
          >
            <div className={s.visitorCardInner}>
              {!activeConv ? (
                <div className={s.emptyState}>اطلاعات مشتری اینجا نمایش داده می‌شود.</div>
              ) : (
                <>
                  <div className={s.visitorSection}>
                    <div className={s.visitorSectionTitle}>
                      <span>اطلاعات بازدیدکننده</span>
                      {mobileVisitorDrawer && (
                        <button type="button" className={s.miniBtn} onClick={() => setMobileVisitorDrawer(false)}>
                          بستن
                        </button>
                      )}
                    </div>
                    <div className={s.kvRow}>
                      <span className={s.kvLabel}>نام</span>
                      <span className={s.kvVal}>{activeConv.visitor.name || '—'}</span>
                    </div>
                    <div className={s.kvRow}>
                      <span className={s.kvLabel}>موبایل</span>
                      <span className={s.kvVal} dir="ltr">
                        {activeConv.visitor.mobile || '—'}
                      </span>
                    </div>
                    <div className={s.kvRow}>
                      <span className={s.kvLabel}>ایمیل</span>
                      <span className={s.kvVal} dir="ltr">
                        {activeConv.visitor.email || '—'}
                      </span>
                    </div>
                    <div className={s.kvRow}>
                      <span className={s.kvLabel}>نوع کاربر</span>
                      <span className={s.kvVal}>
                        {activeConv.visitor.userId ? 'مشتری عضو آوینا' : 'بازدیدکننده مهمان'}
                      </span>
                    </div>
                    <div className={s.kvRow}>
                      <span className={s.kvLabel}>آخرین فعالیت</span>
                      <span className={s.kvVal}>{fmtShortDate(activeConv.visitor.lastSeenAt)}</span>
                    </div>
                  </div>

                  {recentOrders.length > 0 && (
                    <div className={s.visitorSection}>
                      <div className={s.visitorSectionTitle}>سفارش‌های اخیر مشتری در آوینا</div>
                      {recentOrders.map((ord) => (
                        <Link key={ord.number} href={`/admin/orders/${ord.number}`} className={s.orderChip}>
                          <span>{ord.number}</span>
                          <span>{formatToman(ord.totalToman)}</span>
                        </Link>
                      ))}
                    </div>
                  )}

                  <div className={s.visitorSection}>
                    <div className={s.visitorSectionTitle}>صفحه فعلی و مسیر بازدید</div>
                    {activeConv.visitor.currentUrl && (
                      <a
                        href={activeConv.visitor.currentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={s.pageLink}
                      >
                        <strong>{activeConv.visitor.currentTitle || 'صفحه فعلی'}</strong>
                        <span className={s.pageUrl}>{activeConv.visitor.currentUrl}</span>
                      </a>
                    )}
                    {pageViews.slice(0, 8).map((pv) => (
                      <a key={pv.id} href={pv.url} target="_blank" rel="noopener noreferrer" className={s.pageLink}>
                        <span>{pv.title || pv.url}</span>
                        <span className={s.pageUrl}>
                          {fmtTime(pv.createdAt)} · {pv.url}
                        </span>
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* TAB 2: ONLINE VISITORS */}
      {tab === 'visitors' && (
        <div className={s.cardBox} data-lc-visitors-tab>
          <div>
            <h2 className={s.sectionTitle}>بازدیدکنندگان حاضر در فروشگاه ({toFaDigits(onlineVisitors.length)})</h2>
            <p className={s.muted}>کاربران و مهمانانی که در ۱۵ دقیقه اخیر در صفحات فروشگاه فعال بوده‌اند.</p>
          </div>
          {onlineVisitors.length === 0 ? (
            <p className={s.muted}>در حال حاضر بازدیدکننده فعالی ثبت نشده است.</p>
          ) : (
            <div className={s.visitorTableGrid}>
              {onlineVisitors.map((v) => (
                <div key={v.id} className={s.visitorMiniCard}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <strong>{visitorDisplayName(v)}</strong>
                    <span className={`${s.statusPill} ${v.online ? s.statusOpen : s.statusClosed}`}>
                      {v.online ? 'آنلاین' : 'اخیراً فعال'}
                    </span>
                  </div>
                  <div className={s.muted}>
                    {v.userId ? 'مشتری عضو فروشگاه' : 'بازدیدکننده مهمان'}
                    {v.mobile ? ` · ${toFaDigits(v.mobile)}` : ''}
                  </div>
                  {v.currentUrl && (
                    <a href={v.currentUrl} target="_blank" rel="noopener noreferrer" className={s.pageLink}>
                      <strong>{v.currentTitle || 'صفحه فعلی'}</strong>
                      <span className={s.pageUrl}>{v.currentUrl}</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CANNED RESPONSES */}
      {tab === 'canned' && <CannedTab items={canned} onChange={setCanned} />}

      {/* TAB 4: SETTINGS & PRE-CHAT FORM */}
      {tab === 'settings' && (
        <SettingsTab
          initialSettings={settings}
          initialPreChatFields={preChatFields}
          isAdmin={initial.currentOperator.isAdmin}
          onSaved={(nextSettings, nextFields) => {
            setSettings(nextSettings);
            setPreChatFields(nextFields);
          }}
        />
      )}
    </div>
  );
}
