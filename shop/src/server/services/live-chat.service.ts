import 'server-only';
import crypto from 'node:crypto';
import { withTransaction } from '@/lib/db';
import { AppError } from '@/lib/errors';
import {
  IRAN_MOBILE_RE,
  normalizeIranMobile,
  sanitizeChatText,
  validatePreChatValues,
  type ChatCannedResponseDTO,
  type ChatConversationStatus,
  type ChatConversationSummary,
  type ChatMessageDTO,
  type ChatOperatorDTO,
  type ChatOperatorPresence,
  type ChatPageViewDTO,
  type ChatPreChatField,
  type ChatPreChatFieldKey,
  type ChatVisitorPublic,
  type ChatWidgetSettings,
} from '@/lib/live-chat/types';
import { authorize } from '@/server/auth/guards';
import { liveChatBus } from '@/server/live-chat/realtime';
import { readChatUpload, saveChatUpload } from '@/server/live-chat/storage';
import {
  liveChatRepository,
  mapConversationSummary,
  mapMessageRow,
  mapVisitorRow,
  type VisitorRow,
} from '@/server/repositories/live-chat.repository';
import { auditRepository } from '@/server/repositories/audit.repository';
import { getCurrentUser, hasRole, type CurrentUser } from '@/server/services/session.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function operatorDisplayName(user: CurrentUser): string {
  const name = user.fullName?.trim();
  return name ? sanitizeChatText(name, 80) : 'پشتیبان آوینا';
}

function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 1200) return null;
  if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

export const liveChatService = {
  // ═══════════════════════════════════════════════════════════════════════════
  // VISITOR (STOREFRONT) APIs
  // ═══════════════════════════════════════════════════════════════════════════

  async widgetConfig() {
    const [settings, preChatFields, operatorOnline] = await Promise.all([
      liveChatRepository.getSettings(),
      liveChatRepository.getPreChatFields(),
      liveChatRepository.anyOperatorOnline(),
    ]);
    const user = await getCurrentUser();
    return {
      settings,
      preChatFields,
      operatorOnline,
      signedInUser: user
        ? {
            id: user.id,
            name: user.fullName?.trim() || null,
            mobile: user.phone,
          }
        : null,
    };
  },

  async registerVisitor(input: {
    token?: string | null;
    currentUrl?: string | null;
    currentTitle?: string | null;
    referrer?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{ visitorToken: string; visitor: ChatVisitorPublic; isIdentifiedUser: boolean }> {
    const user = await getCurrentUser();
    const rawToken = input.token && UUID_RE.test(input.token.trim()) ? input.token.trim().toLowerCase() : null;

    let visitorToken = rawToken;
    if (!visitorToken && user) {
      const existingByUser = await liveChatRepository.findVisitorByUserId(user.id);
      if (existingByUser) visitorToken = existingByUser.visitor_token.trim();
    }
    if (!visitorToken) visitorToken = crypto.randomUUID();

    const cleanUrl = safeUrl(input.currentUrl);
    const cleanTitle = input.currentTitle ? sanitizeChatText(input.currentTitle, 200) : null;
    const cleanRef = safeUrl(input.referrer);

    const row = await liveChatRepository.upsertVisitor({
      visitorToken,
      userId: user?.id ?? null,
      name: user?.fullName?.trim() ? sanitizeChatText(user.fullName, 120) : null,
      email: null,
      mobile: user?.phone && IRAN_MOBILE_RE.test(user.phone) ? user.phone : null,
      currentUrl: cleanUrl,
      currentTitle: cleanTitle,
      referrer: cleanRef,
      ipAddress: input.ipAddress ? input.ipAddress.slice(0, 64) : null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    });

    if (cleanUrl) {
      await liveChatRepository.recordPageView(row.id, cleanUrl, cleanTitle);
    }

    const visitor = mapVisitorRow(row);
    liveChatBus.publishToStaff('visitor.seen', { visitor });

    return {
      visitorToken: row.visitor_token.trim(),
      visitor,
      isIdentifiedUser: Boolean(user),
    };
  },

  async requireVisitorByToken(token: string | null | undefined): Promise<VisitorRow> {
    const clean = token?.trim().toLowerCase() ?? '';
    if (!UUID_RE.test(clean)) {
      throw new AppError('UNAUTHORIZED', { message: 'شناسه بازدیدکننده معتبر نیست.' });
    }
    const visitor = await liveChatRepository.findVisitorByToken(clean);
    if (!visitor) {
      throw new AppError('UNAUTHORIZED', { message: 'نشست گفتگو یافت نشد.' });
    }
    return visitor;
  },

  async submitPreChat(
    token: string,
    values: Partial<Record<ChatPreChatFieldKey, string>>,
  ): Promise<{ visitor: ChatVisitorPublic }> {
    const visitor = await this.requireVisitorByToken(token);
    const fields = await liveChatRepository.getPreChatFields();
    const errors = validatePreChatValues(fields, values);
    if (Object.keys(errors).length > 0) {
      throw new AppError('INVALID_DATA', {
        message: Object.values(errors)[0] ?? 'اطلاعات واردشده معتبر نیست.',
        cause: errors,
      });
    }

    const name = values.name?.trim() ? sanitizeChatText(values.name, 120) : undefined;
    const email = values.email?.trim() ? sanitizeChatText(values.email.toLowerCase(), 160) : undefined;
    const mobile = values.mobile?.trim() ? normalizeIranMobile(values.mobile) : undefined;

    const updated = await liveChatRepository.updateVisitorProfile(visitor.id, { name, email, mobile });
    const mapped = mapVisitorRow(updated ?? visitor);
    liveChatBus.publishToStaff('visitor.seen', { visitor: mapped });
    return { visitor: mapped };
  },

  async visitorConversation(token: string): Promise<{
    visitor: ChatVisitorPublic;
    conversation: ChatConversationSummary | null;
    messages: ChatMessageDTO[];
  }> {
    const visitor = await this.requireVisitorByToken(token);
    const conv = await liveChatRepository.findLatestConversationForVisitor(visitor.id);
    if (!conv) {
      return { visitor: mapVisitorRow(visitor), conversation: null, messages: [] };
    }
    const rows = await liveChatRepository.listMessages(conv.id, { includeSystem: false });
    return {
      visitor: mapVisitorRow(visitor),
      conversation: mapConversationSummary(conv),
      messages: rows.map((m) => mapMessageRow(m, visitor.visitor_token.trim())),
    };
  },

  /**
   * Visitor sends a text or attachment message.
   * Exact Phase 6 behavior: conversation is created atomically WITH the first message (zero empty conversations).
   */
  async sendVisitorMessage(input: {
    token: string;
    body?: string | null;
    file?: File | null;
    isVoice?: boolean;
  }): Promise<{ conversation: ChatConversationSummary; message: ChatMessageDTO }> {
    const settings = await liveChatRepository.getSettings();
    if (!settings.enabled) {
      throw new AppError('FORBIDDEN', { message: 'پشتیبانی آنلاین در حال حاضر غیرفعال است.' });
    }

    const visitor = await this.requireVisitorByToken(input.token);
    const cleanBody = input.body ? sanitizeChatText(input.body, 4000) : '';
    const stored = input.file ? await saveChatUpload(input.file, Boolean(input.isVoice)) : null;

    if (!cleanBody && !stored) {
      throw new AppError('INVALID_DATA', { message: 'متن پیام یا فایل پیوست الزامی است.' });
    }

    const { convRow, msgRow } = await withTransaction(async (db) => {
      let conv = await liveChatRepository.findLatestConversationForVisitor(visitor.id, db);
      let convId: string;
      if (!conv) {
        const created = await liveChatRepository.createConversation(visitor.id, db);
        convId = created.id;
      } else {
        convId = conv.id;
      }

      const inserted = await liveChatRepository.insertMessage(
        {
          conversationId: convId,
          senderType: 'visitor',
          senderName: visitor.name ?? visitor.mobile?.trim() ?? 'بازدیدکننده',
          type: stored ? stored.messageType : 'text',
          body: cleanBody || null,
          attachmentPath: stored?.relativePath ?? null,
          attachmentName: stored?.originalName ?? null,
          attachmentMime: stored?.mime ?? null,
          attachmentSize: stored?.size ?? null,
        },
        db,
      );

      await liveChatRepository.bumpConversationAfterMessage(convId, 'visitor', db);
      const refreshed = await liveChatRepository.findConversationById(convId, db);
      return { convRow: refreshed!, msgRow: inserted };
    });

    const summary = mapConversationSummary(convRow);
    const staffMsg = mapMessageRow(msgRow);
    const visitorMsg = mapMessageRow(msgRow, visitor.visitor_token.trim());

    liveChatBus.publishToStaff('message.sent', { conversation: summary, message: staffMsg }, summary.id);
    liveChatBus.publishToVisitor(
      visitor.visitor_token.trim(),
      'message.sent',
      { conversation: summary, message: visitorMsg },
      summary.id,
    );

    return { conversation: summary, message: visitorMsg };
  },

  async markVisitorRead(token: string): Promise<{ marked: number }> {
    const visitor = await this.requireVisitorByToken(token);
    const conv = await liveChatRepository.findLatestConversationForVisitor(visitor.id);
    if (!conv) return { marked: 0 };
    const marked = await liveChatRepository.markRead(conv.id, 'visitor');
    if (marked > 0) {
      liveChatBus.publishBoth(
        visitor.visitor_token.trim(),
        'message.read',
        { conversationId: conv.id, reader: 'visitor', readAt: new Date().toISOString() },
        conv.id,
      );
    }
    return { marked };
  },

  async emitVisitorTyping(token: string, isTyping: boolean, preview?: string): Promise<void> {
    const visitor = await this.requireVisitorByToken(token);
    const conv = await liveChatRepository.findLatestConversationForVisitor(visitor.id);
    if (!conv) return;
    liveChatBus.publishToStaff(
      'typing',
      {
        conversationId: conv.id,
        senderType: 'visitor',
        isTyping: Boolean(isTyping),
        preview: isTyping && preview ? sanitizeChatText(preview, 120) : '',
      },
      conv.id,
    );
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OPERATOR / ADMIN APIs (staff = admin | support)
  // ═══════════════════════════════════════════════════════════════════════════

  async adminBootstrap(filter?: { status?: ChatConversationStatus | 'all'; search?: string }) {
    const user = await authorize('support');
    await liveChatRepository.touchOperatorSeen(user.id);

    const [conversations, counts, operators, canned, onlineVisitors, settings, preChatFields] =
      await Promise.all([
        liveChatRepository.listConversations({ status: filter?.status ?? 'all', search: filter?.search }),
        liveChatRepository.conversationCounts(),
        liveChatRepository.listOperators(),
        liveChatRepository.listCannedResponses(),
        liveChatRepository.listOnlineVisitors(),
        liveChatRepository.getSettings(),
        liveChatRepository.getPreChatFields(),
      ]);

    const me = operators.find((o) => o.id === user.id);

    return {
      currentOperator: {
        id: user.id,
        name: operatorDisplayName(user),
        isAdmin: hasRole(user, 'admin'),
        status: me?.status ?? 'online',
      },
      counts,
      conversations: conversations.map(mapConversationSummary),
      operators,
      cannedResponses: canned,
      onlineVisitors,
      settings,
      preChatFields,
    };
  },

  async adminConversationDetail(conversationId: string): Promise<{
    conversation: ChatConversationSummary;
    messages: ChatMessageDTO[];
    pageViews: ChatPageViewDTO[];
    recentOrders: Array<{ number: string; status: string; totalToman: number; createdAt: string }>;
  }> {
    await authorize('support');
    const conv = await liveChatRepository.findConversationById(conversationId);
    if (!conv) throw new AppError('NOT_FOUND', { message: 'گفتگو یافت نشد.' });

    const [messages, pageViews, recentOrders] = await Promise.all([
      liveChatRepository.listMessages(conv.id, { includeSystem: true }),
      liveChatRepository.listVisitorPageViews(conv.visitor_id, 15),
      conv.v_user_id ? liveChatRepository.customerRecentOrders(conv.v_user_id) : Promise.resolve([]),
    ]);

    return {
      conversation: mapConversationSummary(conv),
      messages: messages.map((m) => mapMessageRow(m)),
      pageViews,
      recentOrders,
    };
  },

  async sendOperatorMessage(input: {
    conversationId: string;
    body?: string | null;
    file?: File | null;
    isVoice?: boolean;
  }): Promise<{
    conversation: ChatConversationSummary;
    message: ChatMessageDTO;
    systemMessage?: ChatMessageDTO;
  }> {
    const user = await authorize('support');
    await liveChatRepository.touchOperatorSeen(user.id);

    const conv = await liveChatRepository.findConversationById(input.conversationId);
    if (!conv) throw new AppError('NOT_FOUND', { message: 'گفتگو یافت نشد.' });
    if (conv.status === 'closed') {
      throw new AppError('CONFLICT', { message: 'این گفتگو بسته شده است. ابتدا آن را مجدداً باز کنید.' });
    }

    const cleanBody = input.body ? sanitizeChatText(input.body, 4000) : '';
    const stored = input.file ? await saveChatUpload(input.file, Boolean(input.isVoice)) : null;
    if (!cleanBody && !stored) {
      throw new AppError('INVALID_DATA', { message: 'متن پیام یا فایل پیوست الزامی است.' });
    }

    const opName = operatorDisplayName(user);

    const { refreshed, msgRow, sysRow } = await withTransaction(async (db) => {
      let joinedSys = null;
      // Auto-claim pending/unassigned conversation on first reply (Phase 7 rule)
      if (!conv.assigned_user_id || conv.status === 'pending') {
        await liveChatRepository.assignConversation(conv.id, user.id, db);
        joinedSys = await liveChatRepository.insertMessage(
          {
            conversationId: conv.id,
            senderType: 'system',
            senderUserId: user.id,
            senderName: opName,
            type: 'text',
            body: `${opName} به گفتگو پیوست`,
          },
          db,
        );
      }

      const inserted = await liveChatRepository.insertMessage(
        {
          conversationId: conv.id,
          senderType: 'operator',
          senderUserId: user.id,
          senderName: opName,
          type: stored ? stored.messageType : 'text',
          body: cleanBody || null,
          attachmentPath: stored?.relativePath ?? null,
          attachmentName: stored?.originalName ?? null,
          attachmentMime: stored?.mime ?? null,
          attachmentSize: stored?.size ?? null,
        },
        db,
      );

      await liveChatRepository.bumpConversationAfterMessage(conv.id, 'operator', db);
      const nextConv = await liveChatRepository.findConversationById(conv.id, db);
      return { refreshed: nextConv!, msgRow: inserted, sysRow: joinedSys };
    });

    const summary = mapConversationSummary(refreshed);
    const staffMsg = mapMessageRow(msgRow);
    const visitorMsg = mapMessageRow(msgRow, conv.visitor_token.trim());
    const sysDto = sysRow ? mapMessageRow(sysRow) : undefined;

    if (sysDto) {
      // System notes are panel-only! Never broadcast to visitor channel (Phase 7 decision).
      liveChatBus.publishToStaff('message.sent', { conversation: summary, message: sysDto }, summary.id);
    }
    liveChatBus.publishToStaff('message.sent', { conversation: summary, message: staffMsg }, summary.id);
    liveChatBus.publishToVisitor(
      conv.visitor_token.trim(),
      'message.sent',
      { conversation: summary, message: visitorMsg },
      summary.id,
    );

    return { conversation: summary, message: staffMsg, systemMessage: sysDto };
  },

  async editOperatorMessage(messageId: string, newBody: string): Promise<{ message: ChatMessageDTO }> {
    const user = await authorize('support');
    const existing = await liveChatRepository.findMessageById(messageId);
    if (!existing) throw new AppError('NOT_FOUND', { message: 'پیام یافت نشد.' });
    if (existing.sender_type !== 'operator' || existing.type !== 'text') {
      throw new AppError('INVALID_DATA', { message: 'فقط پیام‌های متنی پشتیبان قابل ویرایش هستند.' });
    }
    if (existing.sender_user_id !== user.id && !hasRole(user, 'admin')) {
      throw new AppError('FORBIDDEN', { message: 'فقط پیام‌های خودتان قابل ویرایش است.' });
    }

    const clean = sanitizeChatText(newBody, 4000);
    if (!clean) throw new AppError('INVALID_DATA', { message: 'متن پیام نمی‌تواند خالی باشد.' });

    const updated = await liveChatRepository.updateMessageBody(messageId, clean);
    const staffDto = mapMessageRow(updated!);
    const visitorDto = mapMessageRow(updated!, existing.visitor_token.trim());

    liveChatBus.publishToStaff('message.edited', { message: staffDto }, existing.conversation_id);
    liveChatBus.publishToVisitor(
      existing.visitor_token.trim(),
      'message.edited',
      { message: visitorDto },
      existing.conversation_id,
    );

    return { message: staffDto };
  },

  async markOperatorRead(conversationId: string): Promise<{ marked: number }> {
    const user = await authorize('support');
    await liveChatRepository.touchOperatorSeen(user.id);
    const conv = await liveChatRepository.findConversationById(conversationId);
    if (!conv) throw new AppError('NOT_FOUND', { message: 'گفتگو یافت نشد.' });
    const marked = await liveChatRepository.markRead(conv.id, 'operator');
    if (marked > 0) {
      liveChatBus.publishBoth(
        conv.visitor_token.trim(),
        'message.read',
        { conversationId: conv.id, reader: 'operator', readAt: new Date().toISOString() },
        conv.id,
      );
    }
    return { marked };
  },

  async emitOperatorTyping(conversationId: string, isTyping: boolean): Promise<void> {
    const user = await authorize('support');
    const conv = await liveChatRepository.findConversationById(conversationId);
    if (!conv) return;
    liveChatBus.publishToVisitor(
      conv.visitor_token.trim(),
      'typing',
      {
        conversationId: conv.id,
        senderType: 'operator',
        operatorName: operatorDisplayName(user),
        isTyping: Boolean(isTyping),
      },
      conv.id,
    );
  },

  /**
   * Assign or transfer conversation to another active operator (Phase 7).
   * Writes a panel-only system message; visitor sees uninterrupted conversation.
   */
  async assignOrTransferConversation(
    conversationId: string,
    targetUserId: string,
  ): Promise<{ conversation: ChatConversationSummary; systemMessage: ChatMessageDTO }> {
    const actor = await authorize('support');
    const conv = await liveChatRepository.findConversationById(conversationId);
    if (!conv) throw new AppError('NOT_FOUND', { message: 'گفتگو یافت نشد.' });
    if (conv.status === 'closed') {
      throw new AppError('CONFLICT', { message: 'انتقال گفتگوی بسته‌شده امکان‌پذیر نیست.' });
    }

    const operators = await liveChatRepository.listOperators();
    const target = operators.find((o) => o.id === targetUserId);
    if (!target) {
      throw new AppError('INVALID_DATA', { message: 'اپراتور مقصد یافت نشد یا غیرفعال است.' });
    }
    if (conv.assigned_user_id === target.id) {
      throw new AppError('INVALID_DATA', { message: 'این گفتگو هم‌اکنون به همین اپراتور اختصاص دارد.' });
    }

    const isAdmin = hasRole(actor, 'admin');
    if (!isAdmin && conv.assigned_user_id && conv.assigned_user_id !== actor.id) {
      throw new AppError('FORBIDDEN', { message: 'فقط مدیر یا اپراتور فعلی می‌تواند این گفتگو را منتقل کند.' });
    }

    const prevName = conv.assigned_user_name ? sanitizeChatText(conv.assigned_user_name, 80) : null;
    const nextName = sanitizeChatText(target.name, 80);
    const note = prevName
      ? `گفتگو از ${prevName} به ${nextName} منتقل شد`
      : `${nextName} به گفتگو پیوست`;

    const { refreshed, sysRow } = await withTransaction(async (db) => {
      await liveChatRepository.assignConversation(conv.id, target.id, db);
      const sys = await liveChatRepository.insertMessage(
        {
          conversationId: conv.id,
          senderType: 'system',
          senderUserId: actor.id,
          senderName: operatorDisplayName(actor),
          type: 'text',
          body: note,
        },
        db,
      );
      const next = await liveChatRepository.findConversationById(conv.id, db);
      return { refreshed: next!, sysRow: sys };
    });

    const summary = mapConversationSummary(refreshed);
    const sysDto = mapMessageRow(sysRow);

    liveChatBus.publishToStaff(
      'conversation.assigned',
      { conversation: summary, message: sysDto, byUserId: actor.id, toUserId: target.id },
      summary.id,
    );

    return { conversation: summary, systemMessage: sysDto };
  },

  async setConversationStatus(
    conversationId: string,
    nextStatus: 'open' | 'closed',
  ): Promise<{ conversation: ChatConversationSummary; systemMessage: ChatMessageDTO }> {
    const actor = await authorize('support');
    const conv = await liveChatRepository.findConversationById(conversationId);
    if (!conv) throw new AppError('NOT_FOUND', { message: 'گفتگو یافت نشد.' });

    const opName = operatorDisplayName(actor);
    const note = nextStatus === 'closed' ? `گفتگو توسط ${opName} بسته شد` : `گفتگو توسط ${opName} مجدداً باز شد`;

    const { refreshed, sysRow } = await withTransaction(async (db) => {
      await liveChatRepository.setConversationStatus(conv.id, nextStatus, db);
      const sys = await liveChatRepository.insertMessage(
        {
          conversationId: conv.id,
          senderType: 'system',
          senderUserId: actor.id,
          senderName: opName,
          type: 'text',
          body: note,
        },
        db,
      );
      const next = await liveChatRepository.findConversationById(conv.id, db);
      return { refreshed: next!, sysRow: sys };
    });

    const summary = mapConversationSummary(refreshed);
    const sysDto = mapMessageRow(sysRow);
    const eventName = nextStatus === 'closed' ? 'conversation.closed' : 'conversation.reopened';

    liveChatBus.publishToStaff(eventName, { conversation: summary, message: sysDto }, summary.id);
    liveChatBus.publishToVisitor(conv.visitor_token.trim(), eventName, { conversation: summary }, summary.id);

    return { conversation: summary, systemMessage: sysDto };
  },

  async setOperatorPresence(status: ChatOperatorPresence): Promise<{ status: ChatOperatorPresence }> {
    const user = await authorize('support');
    if (!['online', 'away', 'offline'].includes(status)) {
      throw new AppError('INVALID_DATA', { message: 'وضعیت نامعتبر است.' });
    }
    await liveChatRepository.setOperatorPresence(user.id, status);
    const anyOnline = await liveChatRepository.anyOperatorOnline();
    liveChatBus.publishToStaff('operator.status', { userId: user.id, status, operatorOnline: anyOnline });
    return { status };
  },

  // ── Canned Responses ──

  async listCannedResponses(): Promise<ChatCannedResponseDTO[]> {
    await authorize('support');
    return liveChatRepository.listCannedResponses();
  },

  async createCannedResponse(input: { shortcut: string; title: string; body: string }): Promise<ChatCannedResponseDTO> {
    const user = await authorize('support');
    const shortcut = sanitizeChatText(input.shortcut.replace(/^\/+/, ''), 40);
    const title = sanitizeChatText(input.title, 80);
    const body = sanitizeChatText(input.body, 2000);
    if (!shortcut || !title || !body) {
      throw new AppError('INVALID_DATA', { message: 'میانبر، عنوان و متن پاسخ آماده الزامی است.' });
    }
    return liveChatRepository.createCannedResponse({ shortcut, title, body, createdBy: user.id });
  },

  async updateCannedResponse(
    id: string,
    input: { shortcut: string; title: string; body: string },
  ): Promise<ChatCannedResponseDTO> {
    await authorize('support');
    const shortcut = sanitizeChatText(input.shortcut.replace(/^\/+/, ''), 40);
    const title = sanitizeChatText(input.title, 80);
    const body = sanitizeChatText(input.body, 2000);
    if (!shortcut || !title || !body) {
      throw new AppError('INVALID_DATA', { message: 'میانبر، عنوان و متن پاسخ آماده الزامی است.' });
    }
    const updated = await liveChatRepository.updateCannedResponse(id, { shortcut, title, body });
    if (!updated) throw new AppError('NOT_FOUND', { message: 'پاسخ آماده یافت نشد.' });
    return updated;
  },

  async deleteCannedResponse(id: string): Promise<void> {
    await authorize('support');
    const ok = await liveChatRepository.deleteCannedResponse(id);
    if (!ok) throw new AppError('NOT_FOUND', { message: 'پاسخ آماده یافت نشد.' });
  },

  // ── Settings & Pre-Chat Fields (Admin Only) ──

  async saveSettingsAndPreChat(input: {
    settings: ChatWidgetSettings;
    preChatFields: ChatPreChatField[];
  }): Promise<{ settings: ChatWidgetSettings; preChatFields: ChatPreChatField[] }> {
    const admin = await authorize('admin');

    const cleanSettings: ChatWidgetSettings = {
      enabled: Boolean(input.settings.enabled),
      widgetTitle: sanitizeChatText(input.settings.widgetTitle || 'پشتیبانی آنلاین آوینا', 80),
      welcomeMessage: sanitizeChatText(input.settings.welcomeMessage || '', 500),
      offlineMessage: sanitizeChatText(input.settings.offlineMessage || '', 500),
      position: input.settings.position === 'bottom_right' ? 'bottom_right' : 'bottom_left',
      soundEnabled: Boolean(input.settings.soundEnabled),
    };

    const validKeys: ChatPreChatFieldKey[] = ['name', 'mobile', 'email'];
    const seen = new Set<ChatPreChatFieldKey>();
    const cleanFields: ChatPreChatField[] = [];
    for (const f of input.preChatFields) {
      if (!validKeys.includes(f.key) || seen.has(f.key)) continue;
      seen.add(f.key);
      cleanFields.push({
        key: f.key,
        enabled: Boolean(f.enabled),
        required: Boolean(f.enabled && f.required),
        sortOrder: cleanFields.length + 1,
      });
    }
    for (const k of validKeys) {
      if (!seen.has(k)) {
        cleanFields.push({ key: k, enabled: false, required: false, sortOrder: cleanFields.length + 1 });
      }
    }

    const result = await withTransaction(async (db) => {
      const savedSettings = await liveChatRepository.saveSettings(cleanSettings, admin.id, db);
      const savedFields = await liveChatRepository.savePreChatFields(cleanFields, db);
      return { settings: savedSettings, preChatFields: savedFields };
    });

    await auditRepository
      .record({
        actorUserId: admin.id,
        action: 'setting.update',
        entityType: 'live_chat_settings',
        entityId: '1',
        meta: { enabled: result.settings.enabled, position: result.settings.position },
        ip: null,
      })
      .catch(() => {});

    return result;
  },

  // ── Private Attachment Serving ──

  async readAttachmentAuthorized(messageId: string, visitorToken?: string | null): Promise<{
    buffer: Buffer;
    mime: string;
    fileName: string;
    inline: boolean;
  }> {
    const msg = await liveChatRepository.findMessageById(messageId);
    if (!msg || !msg.attachment_path) {
      throw new AppError('NOT_FOUND', { message: 'فایل پیوست یافت نشد.' });
    }

    // Authorize: either signed-in staff (admin/support) OR the visitor owning the conversation
    const user = await getCurrentUser();
    const isStaff = Boolean(user && hasRole(user, 'support'));
    const tokenMatches = Boolean(
      visitorToken &&
        UUID_RE.test(visitorToken.trim()) &&
        visitorToken.trim().toLowerCase() === msg.visitor_token.trim().toLowerCase(),
    );

    if (!isStaff && !tokenMatches) {
      throw new AppError('FORBIDDEN', { message: 'دسترسی به این فایل مجاز نیست.' });
    }

    const buffer = await readChatUpload(msg.attachment_path);
    if (!buffer) throw new AppError('NOT_FOUND', { message: 'فایل روی دیسک یافت نشد.' });

    return {
      buffer,
      mime: msg.attachment_mime || 'application/octet-stream',
      fileName: msg.attachment_name || 'attachment',
      inline: msg.type === 'image' || msg.type === 'audio',
    };
  },
};
