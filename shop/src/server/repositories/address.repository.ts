import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';

/**
 * A signed-in user's delivery addresses (table addresses; migrations 002 and 011). Every read and write carries the
 * user id: another user's address is simply not found.
 */
export type AddressRow = {
  id: string;
  user_id: string;
  province: string;
  city: string;
  province_id: number | null;
  city_id: number | null;
  line: string;
  plate: string | null;
  unit: string | null;
  recipient_name: string;
  recipient_phone: string;
  postal_code: string;
  is_default: boolean;
};

export type NewAddress = {
  province: string;
  city: string;
  provinceId: number;
  cityId: number;
  line: string;
  plate: string;
  unit: string | null;
  recipientName: string;
  recipientPhone: string;
  postalCode: string;
  makeDefault?: boolean;
};

const COLS =
  'id::text, user_id::text, province, city, province_id, city_id, line, plate, unit, recipient_name, recipient_phone, postal_code, is_default';

export const addressRepository = {
  async listForUser(userId: string, db?: Queryable): Promise<AddressRow[]> {
    return query<AddressRow>(
      'address.list',
      `SELECT ${COLS} FROM addresses WHERE user_id = $1 AND archived_at IS NULL ORDER BY is_default DESC, id DESC LIMIT 20`,
      [userId],
      db,
    );
  },

  async find(userId: string, id: string, db?: Queryable): Promise<AddressRow | null> {
    return queryOne<AddressRow>(
      'address.find',
      `SELECT ${COLS} FROM addresses WHERE user_id = $1 AND id = $2 AND archived_at IS NULL`,
      [userId, id],
      db,
    );
  },

  /** The first address a user adds becomes the default (one default per user: a unique index). Returns the new row. */
  async create(userId: string, a: NewAddress, db?: Queryable): Promise<AddressRow> {
    const first =
      (
        await query<{ n: number }>(
          'address.count',
          'SELECT count(*)::int AS n FROM addresses WHERE user_id = $1 AND archived_at IS NULL',
          [userId],
          db,
        )
      )[0]!.n === 0;
    const makeDefault = first || a.makeDefault === true;
    if (makeDefault && !first) {
      await query(
        'address.unset_default',
        'UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default',
        [userId],
        db,
      );
    }
    const rows = await query<AddressRow>(
      'address.create',
      `INSERT INTO addresses (user_id, province, city, province_id, city_id, line, plate, unit, recipient_name, recipient_phone, postal_code, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${COLS}`,
      [
        userId,
        a.province,
        a.city,
        a.provinceId,
        a.cityId,
        a.line,
        a.plate,
        a.unit,
        a.recipientName,
        a.recipientPhone,
        a.postalCode,
        makeDefault,
      ],
      db,
    );
    return rows[0]!;
  },
  /** Rewrites one live address of this user (the default flag is not touched here). Null when it is not theirs / is gone. */
  async update(
    userId: string,
    id: string,
    a: Omit<NewAddress, 'makeDefault'>,
    db?: Queryable,
  ): Promise<AddressRow | null> {
    return queryOne<AddressRow>(
      'address.update',
      `UPDATE addresses SET province = $3, city = $4, province_id = $5, city_id = $6, line = $7, plate = $8, unit = $9,
              recipient_name = $10, recipient_phone = $11, postal_code = $12
        WHERE user_id = $1 AND id = $2 AND archived_at IS NULL RETURNING ${COLS}`,
      [
        userId,
        id,
        a.province,
        a.city,
        a.provinceId,
        a.cityId,
        a.line,
        a.plate,
        a.unit,
        a.recipientName,
        a.recipientPhone,
        a.postalCode,
      ],
      db,
    );
  },

  /** Makes this address the user's one default (the others lose it first: a unique index allows only one). */
  async setDefault(userId: string, id: string, db: Queryable): Promise<boolean> {
    const mine = await this.find(userId, id, db);
    if (!mine) return false;
    await query(
      'address.unset_default',
      'UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2',
      [userId, id],
      db,
    );
    await query('address.set_default', 'UPDATE addresses SET is_default = true WHERE user_id = $1 AND id = $2', [
      userId,
      id,
    ], db);
    return true;
  },

  /** «Delete» = archive (the app role cannot DELETE; orders keep their own copy). Returns whether it was a live address of the user. */
  async archive(userId: string, id: string, db?: Queryable): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'address.archive',
      `UPDATE addresses SET archived_at = now(), is_default = false
        WHERE user_id = $1 AND id = $2 AND archived_at IS NULL RETURNING id::text`,
      [userId, id],
      db,
    );
    return rows.length === 1;
  },

  /** After the default was archived: the newest live address becomes the default (none left: nothing to do). */
  async promoteNewest(userId: string, db?: Queryable): Promise<void> {
    await query(
      'address.promote',
      `UPDATE addresses SET is_default = true
        WHERE id = (SELECT id FROM addresses WHERE user_id = $1 AND archived_at IS NULL ORDER BY id DESC LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = $1 AND archived_at IS NULL AND is_default)`,
      [userId],
      db,
    );
  },
};
