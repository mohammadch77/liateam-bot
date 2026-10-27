import 'server-only';
import { query, type Queryable } from '@/lib/db';

/** Who was texted, why and whether it went out (migration 016). Never the text and never a code. */
export type SmsPurpose = 'otp' | 'order' | 'shipping' | 'other';
export type SmsStatus = 'queued' | 'sent' | 'failed';

export const smsLogRepository = {
  async record(
    s: {
      phone: string;
      purpose: SmsPurpose;
      provider: string;
      userId?: string | null;
      orderId?: string | null;
    },
    db?: Queryable,
  ): Promise<string> {
    const rows = await query<{ id: string }>(
      'sms_log.record',
      `INSERT INTO sms_log (user_id, phone, purpose, provider, order_id) VALUES ($1,$2,$3,$4,$5) RETURNING id::text`,
      [s.userId ?? null, s.phone, s.purpose, s.provider, s.orderId ?? null],
      db,
    );
    return rows[0]!.id;
  },

  async setStatus(
    id: string,
    status: SmsStatus,
    detail: { providerRef?: string | null; error?: string | null } = {},
    db?: Queryable,
  ): Promise<void> {
    await query(
      'sms_log.status',
      'UPDATE sms_log SET status = $2, provider_ref = $3, error = $4 WHERE id = $1',
      [id, status, detail.providerRef?.slice(0, 80) ?? null, detail.error?.slice(0, 200) ?? null],
      db,
    );
  },
};
