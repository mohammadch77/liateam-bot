import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';

export type UserRole = 'customer' | 'affiliate' | 'support' | 'employee' | 'admin';
export const USER_ROLES: readonly UserRole[] = ['customer', 'affiliate', 'support', 'employee', 'admin'];
export type UserStatus = 'active' | 'suspended' | 'pending';

export type UserRow = {
  id: string;
  phone: string;
  full_name: string | null;
  status: UserStatus;
  created_at: Date;
  last_login_at: Date | null;
};

const USER_COLS = 'id::text, phone, full_name, status, created_at, last_login_at';

export const userRepository = {
  async findLiveByPhone(phone: string, db?: Queryable): Promise<UserRow | null> {
    return queryOne<UserRow>(
      'user.find_by_phone',
      `SELECT ${USER_COLS} FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [phone],
      db,
    );
  },

  /** Inserts or returns the live user (the partial unique index makes a parallel sign-up safe). */
  async findOrCreate(db: Queryable, phone: string): Promise<{ user: UserRow; created: boolean }> {
    const inserted = await queryOne<UserRow>(
      'user.insert',
      `INSERT INTO users (phone) VALUES ($1)
       ON CONFLICT (phone) WHERE deleted_at IS NULL DO NOTHING
       RETURNING ${USER_COLS}`,
      [phone],
      db,
    );
    if (inserted) return { user: inserted, created: true };
    const existing = await queryOne<UserRow>(
      'user.find_by_phone',
      `SELECT ${USER_COLS} FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [phone],
      db,
    );
    if (!existing) throw new Error('user vanished between insert and select');
    return { user: existing, created: false };
  },

  async touchLogin(db: Queryable, userId: string): Promise<void> {
    await query('user.touch_login', `UPDATE users SET last_login_at = now() WHERE id = $1`, [userId], db);
  },

  async roles(userId: string, db?: Queryable): Promise<UserRole[]> {
    const rows = await query<{ role: UserRole }>(
      'user.roles',
      `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`,
      [userId],
      db,
    );
    return rows.map((r) => r.role);
  },

  /** true when the role was newly granted (false if the user already had it). */
  async grantRole(db: Queryable, userId: string, role: UserRole, grantedBy: string | null): Promise<boolean> {
    const row = await queryOne(
      'user.grant_role',
      `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role) DO NOTHING RETURNING user_id`,
      [userId, role, grantedBy],
      db,
    );
    return row !== null;
  },
};
