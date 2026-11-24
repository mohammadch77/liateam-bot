import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import {
  CHAT_VISITOR_ONLINE_WINDOW_MS,
  type ChatCannedResponseDTO,
  type ChatConversationStatus,
  type ChatConversationSummary,
  type ChatMessageDTO,
  type ChatMessageType,
  type ChatOperatorDTO,
  type ChatOperatorPresence,
  type ChatPageViewDTO,
  type ChatPreChatField,
  type ChatPreChatFieldKey,
  type ChatSenderType,
  type ChatVisitorPublic,
  type ChatWidgetPosition,
  type ChatWidgetSettings,
} from '@/lib/live-chat/types';

export type VisitorRow = {
  id: string;
  visitor_token: string;
  user_id: string | null;
  name: string | null;
  email: string | null;
  mobile: string | null;
  current_url: string | null;
  current_title: string | null;
  referrer: string | null;
  ip_address: string | null;
  user_agent: string | null;
  last_seen_at: Date;
  created_at: Date;
};

export type ConversationRow = {
  id: string;
  visitor_id: string;
  visitor_token: string;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  status: ChatConversationStatus;
  unread_for_operator: number;
  unread_for_visitor: number;
  last_message_at: Date;
  closed_at: Date | null;
  created_at: Date;
  last_message_preview: string | null;
  last_message_type: ChatMessageType | null;
  v_name: string | null;
  v_email: string | null;
  v_mobile: string | null;
  v_user_id: string | null;
  v_current_url: string | null;
  v_current_title: string | null;
  v_last_seen_at: Date;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: ChatSenderType;
  sender_user_id: string | null;
  sender_name: string | null;
  type: ChatMessageType;
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  edited_at: Date | null;
  read_at: Date | null;
  created_at: Date;
};

export function isVisitorOnline(lastSeen: Date | string): boolean {
  const ms = lastSeen instanceof Date ? lastSeen.getTime() : Date.parse(lastSeen);
  return Number.isFinite(ms) && Date.now() - ms <= CHAT_VISITOR_ONLINE_WINDOW_MS;
}

export function mapVisitorRow(r: VisitorRow): ChatVisitorPublic {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    mobile: r.mobile ? r.mobile.trim() : null,
    userId: r.user_id,
    currentUrl: r.current_url,
    currentTitle: r.current_title,
    lastSeenAt: r.last_seen_at.toISOString(),
    online: isVisitorOnline(r.last_seen_at),
  };
}

export function mapMessageRow(r: MessageRow, visitorTokenForUrl?: string): ChatMessageDTO {
  const tokenParam = visitorTokenForUrl ? `?token=${encodeURIComponent(visitorTokenForUrl)}` : '';
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderType: r.sender_type,
    senderUserId: r.sender_user_id,
    senderName: r.sender_name,
    type: r.type,
    body: r.body,
    attachmentUrl: r.attachment_path ? `/api/live-chat/attachments/${r.id}${tokenParam}` : null,
    attachmentName: r.attachment_name,
    attachmentMime: r.attachment_mime,
    attachmentSize: r.attachment_size,
    editedAt: r.edited_at ? r.edited_at.toISOString() : null,
    readAt: r.read_at ? r.read_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

export function mapConversationSummary(r: ConversationRow): ChatConversationSummary {
  return {
    id: r.id,
    status: r.status,
    assignedUserId: r.assigned_user_id,
    assignedUserName: r.assigned_user_name,
    unreadForOperator: Number(r.unread_for_operator) || 0,
    unreadForVisitor: Number(r.unread_for_visitor) || 0,
    lastMessageAt: r.last_message_at.toISOString(),
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    lastMessagePreview: r.last_message_preview,
    lastMessageType: r.last_message_type,
    visitor: {
      id: r.visitor_id,
      name: r.v_name,
      email: r.v_email,
      mobile: r.v_mobile ? r.v_mobile.trim() : null,
      userId: r.v_user_id,
      currentUrl: r.v_current_url,
      currentTitle: r.v_current_title,
      lastSeenAt: r.v_last_seen_at.toISOString(),
      online: isVisitorOnline(r.v_last_seen_at),
    },
  };
}

const DEFAULT_SETTINGS: ChatWidgetSettings = {
  enabled: true,
  widgetTitle: 'پشتیبانی آنلاین آوینا',
  welcomeMessage: 'سلام! چطور می‌تونیم در انتخاب محصول یا پیگیری سفارش کمکتون کنیم؟',
  offlineMessage: 'در حال حاضر پشتیبان آنلاین نیست؛ پیام خود را بگذارید تا در اولین فرصت پاسخ دهیم.',
  position: 'bottom_left',
  soundEnabled: true,
};

export const liveChatRepository = {
  async getSettings(db?: Queryable): Promise<ChatWidgetSettings> {
    const row = await queryOne<{
      enabled: boolean;
      widget_title: string;
      welcome_message: string;
      offline_message: string;
      position: ChatWidgetPosition;
      sound_enabled: boolean;
    }>(
      'live_chat.get_settings',
      `SELECT enabled, widget_title, welcome_message, offline_message, position, sound_enabled
         FROM chat_settings WHERE id = 1`,
      [],
      db,
    );
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      enabled: row.enabled,
      widgetTitle: row.widget_title,
      welcomeMessage: row.welcome_message,
      offlineMessage: row.offline_message,
      position: row.position,
      soundEnabled: row.sound_enabled,
    };
  },

  async saveSettings(
    input: ChatWidgetSettings,
    actorUserId: string,
    db?: Queryable,
  ): Promise<ChatWidgetSettings> {
    await query(
      'live_chat.save_settings',
      `INSERT INTO chat_settings (id, enabled, widget_title, welcome_message, offline_message, position, sound_enabled, updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5::chat_widget_position, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         widget_title = EXCLUDED.widget_title,
         welcome_message = EXCLUDED.welcome_message,
         offline_message = EXCLUDED.offline_message,
         position = EXCLUDED.position,
         sound_enabled = EXCLUDED.sound_enabled,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [
        input.enabled,
        input.widgetTitle,
        input.welcomeMessage,
        input.offlineMessage,
        input.position,
        input.soundEnabled,
        actorUserId,
      ],
      db,
    );
    return this.getSettings(db);
  },

  async getPreChatFields(db?: Queryable): Promise<ChatPreChatField[]> {
    const rows = await query<{
      field_key: ChatPreChatFieldKey;
      enabled: boolean;
      required: boolean;
      sort_order: number;
    }>(
      'live_chat.get_prechat_fields',
      `SELECT field_key, enabled, required, sort_order
         FROM chat_prechat_fields
        ORDER BY sort_order ASC, field_key ASC`,
      [],
      db,
    );
    if (!rows.length) {
      return [
        { key: 'name', enabled: true, required: true, sortOrder: 1 },
        { key: 'mobile', enabled: true, required: true, sortOrder: 2 },
        { key: 'email', enabled: false, required: false, sortOrder: 3 },
      ];
    }
    return rows.map((r) => ({
      key: r.field_key,
      enabled: r.enabled,
      required: r.required,
      sortOrder: Number(r.sort_order),
    }));
  },

  async savePreChatFields(fields: readonly ChatPreChatField[], db?: Queryable): Promise<ChatPreChatField[]> {
    for (const f of fields) {
      await query(
        'live_chat.save_prechat_field',
        `INSERT INTO chat_prechat_fields (field_key, enabled, required, sort_order)
         VALUES ($1::chat_prechat_field_key, $2, $3, $4)
         ON CONFLICT (field_key) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           required = EXCLUDED.required,
           sort_order = EXCLUDED.sort_order`,
        [f.key, f.enabled, f.enabled ? f.required : false, f.sortOrder],
        db,
      );
    }
    return this.getPreChatFields(db);
  },

  async anyOperatorOnline(db?: Queryable): Promise<boolean> {
    const row = await queryOne<{ cnt: string }>(
      'live_chat.any_operator_online',
      `SELECT COUNT(*)::text AS cnt
         FROM chat_operator_status s
         JOIN user_roles r ON r.user_id = s.user_id AND r.role IN ('admin', 'support')
         JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL AND u.status = 'active'
        WHERE s.status = 'online' AND s.last_seen_at >= now() - interval '15 minutes'`,
      [],
      db,
    );
    return Number(row?.cnt ?? '0') > 0;
  },

  async setOperatorPresence(
    userId: string,
    status: ChatOperatorPresence,
    db?: Queryable,
  ): Promise<ChatOperatorPresence> {
    await query(
      'live_chat.set_operator_presence',
      `INSERT INTO chat_operator_status (user_id, status, last_seen_at)
       VALUES ($1, $2::chat_operator_presence, now())
       ON CONFLICT (user_id) DO UPDATE SET
         status = EXCLUDED.status,
         last_seen_at = now()`,
      [userId, status],
      db,
    );
    return status;
  },

  async touchOperatorSeen(userId: string, db?: Queryable): Promise<void> {
    await query(
      'live_chat.touch_operator_seen',
      `INSERT INTO chat_operator_status (user_id, status, last_seen_at)
       VALUES ($1, 'online', now())
       ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now()`,
      [userId],
      db,
    );
  },

  async listOperators(db?: Queryable): Promise<ChatOperatorDTO[]> {
    const rows = await query<{
      id: string;
      full_name: string | null;
      phone: string;
      is_admin: boolean;
      status: ChatOperatorPresence | null;
      last_seen_at: Date | null;
    }>(
      'live_chat.list_operators',
      `SELECT u.id::text, u.full_name, u.phone,
              BOOL_OR(r.role = 'admin') AS is_admin,
              os.status,
              os.last_seen_at
         FROM users u
         JOIN user_roles r ON r.user_id = u.id AND r.role IN ('admin', 'support')
         LEFT JOIN chat_operator_status os ON os.user_id = u.id
        WHERE u.deleted_at IS NULL AND u.status = 'active'
        GROUP BY u.id, u.full_name, u.phone, os.status, os.last_seen_at
        ORDER BY
          CASE WHEN os.status = 'online' AND os.last_seen_at >= now() - interval '15 minutes' THEN 0
               WHEN os.status = 'away' THEN 1
               ELSE 2 END,
          u.id ASC`,
      [],
      db,
    );
    return rows.map((r) => {
      const stale = !r.last_seen_at || Date.now() - r.last_seen_at.getTime() > 15 * 60_000;
      const effectiveStatus: ChatOperatorPresence =
        r.status === 'offline' || stale ? 'offline' : (r.status ?? 'offline');
      return {
        id: r.id,
        name: r.full_name?.trim() || r.phone,
        phone: r.phone,
        isAdmin: r.is_admin,
        status: effectiveStatus,
        lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
      };
    });
  },

  async findVisitorByToken(token: string, db?: Queryable): Promise<VisitorRow | null> {
    return queryOne<VisitorRow>(
      'live_chat.find_visitor_by_token',
      `SELECT id::text, visitor_token, user_id::text, name, email, mobile,
              current_url, current_title, referrer, ip_address, user_agent, last_seen_at, created_at
         FROM chat_visitors
        WHERE visitor_token = $1`,
      [token],
      db,
    );
  },

  async findVisitorByUserId(userId: string, db?: Queryable): Promise<VisitorRow | null> {
    return queryOne<VisitorRow>(
      'live_chat.find_visitor_by_user_id',
      `SELECT id::text, visitor_token, user_id::text, name, email, mobile,
              current_url, current_title, referrer, ip_address, user_agent, last_seen_at, created_at
         FROM chat_visitors
        WHERE user_id = $1
        ORDER BY last_seen_at DESC
        LIMIT 1`,
      [userId],
      db,
    );
  },

  async upsertVisitor(
    input: {
      visitorToken: string;
      userId: string | null;
      name: string | null;
      email: string | null;
      mobile: string | null;
      currentUrl: string | null;
      currentTitle: string | null;
      referrer: string | null;
      ipAddress: string | null;
      userAgent: string | null;
    },
    db?: Queryable,
  ): Promise<VisitorRow> {
    const row = await queryOne<VisitorRow>(
      'live_chat.upsert_visitor',
      `INSERT INTO chat_visitors
         (visitor_token, user_id, name, email, mobile, current_url, current_title, referrer, ip_address, user_agent, last_seen_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
       ON CONFLICT (visitor_token) DO UPDATE SET
         user_id = COALESCE(EXCLUDED.user_id, chat_visitors.user_id),
         name = COALESCE(EXCLUDED.name, chat_visitors.name),
         email = COALESCE(EXCLUDED.email, chat_visitors.email),
         mobile = COALESCE(EXCLUDED.mobile, chat_visitors.mobile),
         current_url = COALESCE(EXCLUDED.current_url, chat_visitors.current_url),
         current_title = COALESCE(EXCLUDED.current_title, chat_visitors.current_title),
         referrer = COALESCE(chat_visitors.referrer, EXCLUDED.referrer),
         ip_address = COALESCE(EXCLUDED.ip_address, chat_visitors.ip_address),
         user_agent = COALESCE(EXCLUDED.user_agent, chat_visitors.user_agent),
         last_seen_at = now(),
         updated_at = now()
       RETURNING id::text, visitor_token, user_id::text, name, email, mobile,
                 current_url, current_title, referrer, ip_address, user_agent, last_seen_at, created_at`,
      [
        input.visitorToken,
        input.userId,
        input.name,
        input.email,
        input.mobile,
        input.currentUrl,
        input.currentTitle,
        input.referrer,
        input.ipAddress,
        input.userAgent,
      ],
      db,
    );
    return row!;
  },

  async updateVisitorProfile(
    visitorId: string,
    patch: { name?: string | null; email?: string | null; mobile?: string | null },
    db?: Queryable,
  ): Promise<VisitorRow | null> {
    return queryOne<VisitorRow>(
      'live_chat.update_visitor_profile',
      `UPDATE chat_visitors
          SET name = COALESCE($2, name),
              email = COALESCE($3, email),
              mobile = COALESCE($4, mobile),
              last_seen_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING id::text, visitor_token, user_id::text, name, email, mobile,
                  current_url, current_title, referrer, ip_address, user_agent, last_seen_at, created_at`,
      [visitorId, patch.name ?? null, patch.email ?? null, patch.mobile ?? null],
      db,
    );
  },

  async recordPageView(
    visitorId: string,
    url: string,
    title: string | null,
    db?: Queryable,
  ): Promise<void> {
    // Avoid spamming duplicate consecutive views of the exact same URL within 60 seconds
    const latest = await queryOne<{ url: string; created_at: Date }>(
      'live_chat.latest_page_view',
      `SELECT url, created_at FROM chat_page_views WHERE visitor_id = $1 ORDER BY id DESC LIMIT 1`,
      [visitorId],
      db,
    );
    if (latest && latest.url === url && Date.now() - latest.created_at.getTime() < 60_000) return;
    await query(
      'live_chat.insert_page_view',
      `INSERT INTO chat_page_views (visitor_id, url, title) VALUES ($1, $2, $3)`,
      [visitorId, url, title],
      db,
    );
  },

  async listVisitorPageViews(visitorId: string, limit = 15, db?: Queryable): Promise<ChatPageViewDTO[]> {
    const rows = await query<{ id: string; url: string; title: string | null; created_at: Date }>(
      'live_chat.list_page_views',
      `SELECT id::text, url, title, created_at
         FROM chat_page_views
        WHERE visitor_id = $1
        ORDER BY id DESC
        LIMIT $2`,
      [visitorId, limit],
      db,
    );
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      createdAt: r.created_at.toISOString(),
    }));
  },

  async listOnlineVisitors(db?: Queryable): Promise<ChatVisitorPublic[]> {
    const rows = await query<VisitorRow>(
      'live_chat.list_online_visitors',
      `SELECT id::text, visitor_token, user_id::text, name, email, mobile,
              current_url, current_title, referrer, ip_address, user_agent, last_seen_at, created_at
         FROM chat_visitors
        WHERE last_seen_at >= now() - interval '15 minutes'
        ORDER BY last_seen_at DESC
        LIMIT 80`,
      [],
      db,
    );
    return rows.map(mapVisitorRow);
  },

  async findLatestConversationForVisitor(
    visitorId: string,
    db?: Queryable,
  ): Promise<ConversationRow | null> {
    return queryOne<ConversationRow>(
      'live_chat.find_latest_conv_for_visitor',
      `SELECT c.id::text, c.visitor_id::text, v.visitor_token,
              c.assigned_user_id::text,
              COALESCE(au.full_name, au.phone) AS assigned_user_name,
              c.status, c.unread_for_operator, c.unread_for_visitor,
              c.last_message_at, c.closed_at, c.created_at,
              lm.body AS last_message_preview, lm.type AS last_message_type,
              v.name AS v_name, v.email AS v_email, v.mobile AS v_mobile,
              v.user_id::text AS v_user_id, v.current_url AS v_current_url,
              v.current_title AS v_current_title, v.last_seen_at AS v_last_seen_at
         FROM chat_conversations c
         JOIN chat_visitors v ON v.id = c.visitor_id
         LEFT JOIN users au ON au.id = c.assigned_user_id
         LEFT JOIN LATERAL (
           SELECT body, type FROM chat_messages
            WHERE conversation_id = c.id AND sender_type <> 'system'
            ORDER BY id DESC LIMIT 1
         ) lm ON TRUE
        WHERE c.visitor_id = $1
        ORDER BY CASE WHEN c.status = 'closed' THEN 1 ELSE 0 END, c.last_message_at DESC
        LIMIT 1`,
      [visitorId],
      db,
    );
  },

  async findConversationById(id: string, db?: Queryable): Promise<ConversationRow | null> {
    return queryOne<ConversationRow>(
      'live_chat.find_conv_by_id',
      `SELECT c.id::text, c.visitor_id::text, v.visitor_token,
              c.assigned_user_id::text,
              COALESCE(au.full_name, au.phone) AS assigned_user_name,
              c.status, c.unread_for_operator, c.unread_for_visitor,
              c.last_message_at, c.closed_at, c.created_at,
              lm.body AS last_message_preview, lm.type AS last_message_type,
              v.name AS v_name, v.email AS v_email, v.mobile AS v_mobile,
              v.user_id::text AS v_user_id, v.current_url AS v_current_url,
              v.current_title AS v_current_title, v.last_seen_at AS v_last_seen_at
         FROM chat_conversations c
         JOIN chat_visitors v ON v.id = c.visitor_id
         LEFT JOIN users au ON au.id = c.assigned_user_id
         LEFT JOIN LATERAL (
           SELECT body, type FROM chat_messages
            WHERE conversation_id = c.id AND sender_type <> 'system'
            ORDER BY id DESC LIMIT 1
         ) lm ON TRUE
        WHERE c.id = $1`,
      [id],
      db,
    );
  },

  async createConversation(visitorId: string, db?: Queryable): Promise<{ id: string }> {
    const row = await queryOne<{ id: string }>(
      'live_chat.create_conversation',
      `INSERT INTO chat_conversations (visitor_id, status, last_message_at)
       VALUES ($1, 'pending', now())
       RETURNING id::text`,
      [visitorId],
      db,
    );
    return row!;
  },

  async listConversations(
    filter: { status?: ChatConversationStatus | 'all'; search?: string; limit?: number },
    db?: Queryable,
  ): Promise<ConversationRow[]> {
    const params: unknown[] = [];
    const where: string[] = [];

    if (filter.status && filter.status !== 'all') {
      params.push(filter.status);
      where.push(`c.status = $${params.length}::chat_conversation_status`);
    }
    if (filter.search?.trim()) {
      params.push(`%${filter.search.trim()}%`);
      const p = `$${params.length}`;
      where.push(
        `(COALESCE(v.name, '') ILIKE ${p} OR COALESCE(v.mobile, '') ILIKE ${p} OR COALESCE(v.email, '') ILIKE ${p} OR COALESCE(lm.body, '') ILIKE ${p})`,
      );
    }

    const limit = Math.min(200, Math.max(1, filter.limit ?? 80));
    params.push(limit);

    return query<ConversationRow>(
      'live_chat.list_conversations',
      `SELECT c.id::text, c.visitor_id::text, v.visitor_token,
              c.assigned_user_id::text,
              COALESCE(au.full_name, au.phone) AS assigned_user_name,
              c.status, c.unread_for_operator, c.unread_for_visitor,
              c.last_message_at, c.closed_at, c.created_at,
              lm.body AS last_message_preview, lm.type AS last_message_type,
              v.name AS v_name, v.email AS v_email, v.mobile AS v_mobile,
              v.user_id::text AS v_user_id, v.current_url AS v_current_url,
              v.current_title AS v_current_title, v.last_seen_at AS v_last_seen_at
         FROM chat_conversations c
         JOIN chat_visitors v ON v.id = c.visitor_id
         LEFT JOIN users au ON au.id = c.assigned_user_id
         LEFT JOIN LATERAL (
           SELECT body, type FROM chat_messages
            WHERE conversation_id = c.id AND sender_type <> 'system'
            ORDER BY id DESC LIMIT 1
         ) lm ON TRUE
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.last_message_at DESC
        LIMIT $${params.length}`,
      params,
      db,
    );
  },

  async conversationCounts(
    db?: Queryable,
  ): Promise<{ pending: number; open: number; closed: number; unreadTotal: number }> {
    const row = await queryOne<{
      pending: string;
      open: string;
      closed: string;
      unread_total: string;
    }>(
      'live_chat.conv_counts',
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
         COUNT(*) FILTER (WHERE status = 'open')::text AS open,
         COUNT(*) FILTER (WHERE status = 'closed')::text AS closed,
         COALESCE(SUM(unread_for_operator) FILTER (WHERE status <> 'closed'), 0)::text AS unread_total
       FROM chat_conversations`,
      [],
      db,
    );
    return {
      pending: Number(row?.pending ?? '0'),
      open: Number(row?.open ?? '0'),
      closed: Number(row?.closed ?? '0'),
      unreadTotal: Number(row?.unread_total ?? '0'),
    };
  },

  async activeBadgeCount(db?: Queryable): Promise<number> {
    const row = await queryOne<{ cnt: string }>(
      'live_chat.badge_count',
      `SELECT COUNT(*)::text AS cnt
         FROM chat_conversations
        WHERE status = 'pending' OR (status = 'open' AND unread_for_operator > 0)`,
      [],
      db,
    );
    return Number(row?.cnt ?? '0');
  },

  async insertMessage(
    input: {
      conversationId: string;
      senderType: ChatSenderType;
      senderUserId?: string | null;
      senderName?: string | null;
      type: ChatMessageType;
      body?: string | null;
      attachmentPath?: string | null;
      attachmentName?: string | null;
      attachmentMime?: string | null;
      attachmentSize?: number | null;
    },
    db?: Queryable,
  ): Promise<MessageRow> {
    const row = await queryOne<MessageRow>(
      'live_chat.insert_message',
      `INSERT INTO chat_messages
         (conversation_id, sender_type, sender_user_id, sender_name, type, body,
          attachment_path, attachment_name, attachment_mime, attachment_size)
       VALUES ($1, $2::chat_sender_type, $3, $4, $5::chat_message_type, $6, $7, $8, $9, $10)
       RETURNING id::text, conversation_id::text, sender_type, sender_user_id::text, sender_name,
                 type, body, attachment_path, attachment_name, attachment_mime, attachment_size,
                 edited_at, read_at, created_at`,
      [
        input.conversationId,
        input.senderType,
        input.senderUserId ?? null,
        input.senderName ?? null,
        input.type,
        input.body ?? null,
        input.attachmentPath ?? null,
        input.attachmentName ?? null,
        input.attachmentMime ?? null,
        input.attachmentSize ?? null,
      ],
      db,
    );
    return row!;
  },

  async listMessages(
    conversationId: string,
    opts: { includeSystem: boolean; limit?: number },
    db?: Queryable,
  ): Promise<MessageRow[]> {
    const limit = Math.min(300, Math.max(1, opts.limit ?? 150));
    const sysFilter = opts.includeSystem ? '' : `AND sender_type <> 'system'`;
    return query<MessageRow>(
      'live_chat.list_messages',
      `SELECT id::text, conversation_id::text, sender_type, sender_user_id::text, sender_name,
              type, body, attachment_path, attachment_name, attachment_mime, attachment_size,
              edited_at, read_at, created_at
         FROM (
           SELECT * FROM chat_messages
            WHERE conversation_id = $1 ${sysFilter}
            ORDER BY id DESC
            LIMIT $2
         ) sub
        ORDER BY id ASC`,
      [conversationId, limit],
      db,
    );
  },

  async findMessageById(id: string, db?: Queryable): Promise<(MessageRow & { visitor_token: string }) | null> {
    return queryOne<MessageRow & { visitor_token: string }>(
      'live_chat.find_message_by_id',
      `SELECT m.id::text, m.conversation_id::text, m.sender_type, m.sender_user_id::text, m.sender_name,
              m.type, m.body, m.attachment_path, m.attachment_name, m.attachment_mime, m.attachment_size,
              m.edited_at, m.read_at, m.created_at, v.visitor_token
         FROM chat_messages m
         JOIN chat_conversations c ON c.id = m.conversation_id
         JOIN chat_visitors v ON v.id = c.visitor_id
        WHERE m.id = $1`,
      [id],
      db,
    );
  },

  async updateMessageBody(id: string, body: string, db?: Queryable): Promise<MessageRow | null> {
    return queryOne<MessageRow>(
      'live_chat.update_message_body',
      `UPDATE chat_messages
          SET body = $2, edited_at = now()
        WHERE id = $1
        RETURNING id::text, conversation_id::text, sender_type, sender_user_id::text, sender_name,
                  type, body, attachment_path, attachment_name, attachment_mime, attachment_size,
                  edited_at, read_at, created_at`,
      [id, body],
      db,
    );
  },

  async bumpConversationAfterMessage(
    conversationId: string,
    senderType: 'visitor' | 'operator',
    db?: Queryable,
  ): Promise<void> {
    if (senderType === 'visitor') {
      await query(
        'live_chat.bump_conv_visitor',
        `UPDATE chat_conversations
            SET unread_for_operator = unread_for_operator + 1,
                last_message_at = now(),
                status = CASE WHEN status = 'closed' THEN 'pending' ELSE status END,
                closed_at = CASE WHEN status = 'closed' THEN NULL ELSE closed_at END,
                updated_at = now()
          WHERE id = $1`,
        [conversationId],
        db,
      );
    } else {
      await query(
        'live_chat.bump_conv_operator',
        `UPDATE chat_conversations
            SET unread_for_visitor = unread_for_visitor + 1,
                unread_for_operator = 0,
                last_message_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [conversationId],
        db,
      );
    }
  },

  async markRead(conversationId: string, reader: 'visitor' | 'operator', db?: Queryable): Promise<number> {
    const targetSender: ChatSenderType = reader === 'visitor' ? 'operator' : 'visitor';
    const rows = await query<{ id: string }>(
      'live_chat.mark_messages_read',
      `UPDATE chat_messages
          SET read_at = now()
        WHERE conversation_id = $1 AND sender_type = $2::chat_sender_type AND read_at IS NULL
        RETURNING id::text`,
      [conversationId, targetSender],
      db,
    );
    const col = reader === 'visitor' ? 'unread_for_visitor' : 'unread_for_operator';
    await query(
      'live_chat.reset_unread',
      `UPDATE chat_conversations SET ${col} = 0, updated_at = now() WHERE id = $1`,
      [conversationId],
      db,
    );
    return rows.length;
  },

  async assignConversation(
    conversationId: string,
    targetUserId: string,
    db?: Queryable,
  ): Promise<void> {
    await query(
      'live_chat.assign_conversation',
      `UPDATE chat_conversations
          SET assigned_user_id = $2,
              status = CASE WHEN status = 'pending' THEN 'open' ELSE status END,
              updated_at = now()
        WHERE id = $1`,
      [conversationId, targetUserId],
      db,
    );
  },

  async setConversationStatus(
    conversationId: string,
    status: ChatConversationStatus,
    db?: Queryable,
  ): Promise<void> {
    await query(
      'live_chat.set_conversation_status',
      `UPDATE chat_conversations
          SET status = $2::chat_conversation_status,
              closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [conversationId, status],
      db,
    );
  },

  async listCannedResponses(db?: Queryable): Promise<ChatCannedResponseDTO[]> {
    const rows = await query<{ id: string; shortcut: string; title: string; body: string }>(
      'live_chat.list_canned',
      `SELECT id::text, shortcut, title, body
         FROM chat_canned_responses
        ORDER BY shortcut ASC`,
      [],
      db,
    );
    return rows;
  },

  async createCannedResponse(
    input: { shortcut: string; title: string; body: string; createdBy: string },
    db?: Queryable,
  ): Promise<ChatCannedResponseDTO> {
    const row = await queryOne<ChatCannedResponseDTO>(
      'live_chat.create_canned',
      `INSERT INTO chat_canned_responses (shortcut, title, body, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text, shortcut, title, body`,
      [input.shortcut, input.title, input.body, input.createdBy],
      db,
    );
    return row!;
  },

  async updateCannedResponse(
    id: string,
    input: { shortcut: string; title: string; body: string },
    db?: Queryable,
  ): Promise<ChatCannedResponseDTO | null> {
    return queryOne<ChatCannedResponseDTO>(
      'live_chat.update_canned',
      `UPDATE chat_canned_responses
          SET shortcut = $2, title = $3, body = $4, updated_at = now()
        WHERE id = $1
        RETURNING id::text, shortcut, title, body`,
      [id, input.shortcut, input.title, input.body],
      db,
    );
  },

  async deleteCannedResponse(id: string, db?: Queryable): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'live_chat.delete_canned',
      `DELETE FROM chat_canned_responses WHERE id = $1 RETURNING id::text`,
      [id],
      db,
    );
    return rows.length > 0;
  },

  async customerRecentOrders(
    userId: string,
    db?: Queryable,
  ): Promise<Array<{ number: string; status: string; totalToman: number; createdAt: string }>> {
    const rows = await query<{
      number: string;
      status: string;
      total_payable: string;
      created_at: Date;
    }>(
      'live_chat.customer_recent_orders',
      `SELECT number, status::text, total_payable::text, created_at
         FROM orders
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 5`,
      [userId],
      db,
    );
    return rows.map((r) => ({
      number: r.number,
      status: r.status,
      totalToman: Number(r.total_payable) || 0,
      createdAt: r.created_at.toISOString(),
    }));
  },
};
