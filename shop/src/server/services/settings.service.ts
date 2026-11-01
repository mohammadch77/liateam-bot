import 'server-only';
import { getConfig } from '@/lib/config';
import { AppError } from '@/lib/errors';
import {
  SETTINGS,
  SECRET_KEYS,
  fromFormField,
  isSettingKey,
  keysOf,
  maskSecret,
  validateSetting,
  type SettingGroup,
  type SettingKey,
} from '@/lib/settings/registry';
import { authorize } from '@/server/auth/guards';
import { dataChanged } from '@/server/cache-events';
import type { RequestMeta } from '@/server/http/request';
import { auditRepository } from '@/server/repositories/audit.repository';
import { secretSettingsRepository } from '@/server/repositories/secret-settings.repository';
import { siteSettingsRepository } from '@/server/repositories/site-settings.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { secretSettingsService, secretStorageEnabled } from './secret-settings.service';
import { settingsRead } from './settings-read.service';

/**
 * The admin's settings screen: reads the registry's values (plain ones and the MASKED state of secrets), saves one group
 * at a time, replaces a secret. Admins only (checked here, not just by the page). Every change is audited — plain values
 * with before and after, secrets only as «changed» — and applies at once: the caches drop, so the header, cart and
 * checkout show it on the next request instead of a minute later.
 */
export type FieldView = {
  key: SettingKey;
  label: string;
  hint?: string;
  kind: (typeof SETTINGS)[SettingKey]['kind'];
  unit?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  placeholder: boolean;
  value: unknown;
  /** secrets only: whether a value is stored, and how it may be shown (••••1234); the value itself never leaves the server */
  secret?: { configured: boolean; mask: string | null; updatedAt: Date | null };
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const settingsService = {
  /** the fields of one group, ready for the form */
  async group(group: SettingGroup): Promise<{ fields: FieldView[]; secretsEnabled: boolean }> {
    await authorize('admin');
    const values = await settingsRead.fresh();
    const stored = new Map((await secretSettingsRepository.list(SECRET_KEYS)).map((s) => [s.key, s]));
    const fields = keysOf(group).map((key): FieldView => {
      const d = SETTINGS[key];
      const base = {
        key,
        label: d.label,
        hint: d.hint,
        kind: d.kind,
        unit: d.unit,
        options: d.options,
        placeholder: !!d.placeholder,
      };
      if (d.kind !== 'secret') return { ...base, value: values.get(key) };
      const row = stored.get(key);
      return {
        ...base,
        value: null, // a secret's value is never put in the view
        secret: {
          configured: !!row,
          mask: row ? maskSecret(row.hint) : null,
          updatedAt: row?.updatedAt ?? null,
        },
      };
    });
    return { fields, secretsEnabled: secretStorageEnabled() };
  },

  /**
   * Saves the plain settings of one group from the form (secrets in it are saved with setSecret). Returns the keys that
   * actually changed. Nothing is written when any field is invalid.
   */
  async save(
    group: SettingGroup,
    form: { get(n: string): unknown; has(n: string): boolean },
    meta: RequestMeta,
  ): Promise<SettingKey[]> {
    const admin = await authorize('admin');
    const keys = keysOf(group).filter((k) => SETTINGS[k].kind !== 'secret');
    const next = new Map<SettingKey, unknown>();
    for (const key of keys) {
      const r = validateSetting(key, fromFormField(key, form));
      if (!r.ok) throw new AppError('INVALID_DATA', { message: r.error });
      next.set(key, r.value);
    }
    // the simulators (payment gateway, SMS) are for staging and development only
    if (
      getConfig().APP_ENV === 'production' &&
      (next.get('payment.provider') === 'dev' || next.get('sms.provider') === 'dev')
    )
      throw new AppError('INVALID_DATA', {
        message: 'شبیه‌ساز (آزمایشی) روی سایت اصلی مجاز نیست؛ سرویس واقعی را انتخاب کنید.',
      });
    const before = await settingsRead.fresh();
    const changed = keys.filter((k) => !same(before.get(k), next.get(k)));
    if (!changed.length) {
      dataChanged(); // a save with nothing new still makes the shop read everything again (prices included)
      return [];
    }
    await withTransaction(async (db) => {
      for (const key of changed) {
        await siteSettingsRepository.set(key, next.get(key), admin.id, db);
        await auditRepository.record(
          {
            actorUserId: admin.id,
            action: 'setting.update',
            entityType: 'setting',
            entityId: key,
            meta: { before: before.get(key), after: next.get(key) },
            ip: meta.ip,
          },
          db,
        );
      }
    });
    settingsRead.forget();
    dataChanged();
    return changed;
  },

  /** Replaces a secret. The audit says only that it changed — no value, no hint, no length. */
  async setSecret(key: string, value: string, meta: RequestMeta): Promise<void> {
    const admin = await authorize('admin');
    if (!isSettingKey(key) || SETTINGS[key].kind !== 'secret') throw new AppError('INVALID_DATA');
    const r = validateSetting(key, value);
    if (!r.ok) throw new AppError('INVALID_DATA', { message: r.error });
    await withTransaction(async (db) => {
      await secretSettingsService.store(db, key, r.value as string, admin.id);
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: 'secret.update',
          entityType: 'setting',
          entityId: key,
          meta: { changed: true },
          ip: meta.ip,
        },
        db,
      );
    });
  },
};
