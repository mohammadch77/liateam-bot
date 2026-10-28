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
      `SELECT ${COLS} FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id DESC LIMIT 20`,
      [userId],
      db,
    );
  },

  async find(userId: string, id: string, db?: Queryable): Promise<AddressRow | null> {
    return queryOne<AddressRow>(
      'address.find',
      `SELECT ${COLS} FROM addresses WHERE user_id = $1 AND id = $2`,
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
          'SELECT count(*)::int AS n FROM addresses WHERE user_id = $1',
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
};
