import 'server-only';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import {
  affiliateRepository,
  type AffiliateSource,
  type AffiliateStatus,
  type ChannelType,
  type Followers,
} from '@/server/repositories/affiliate.repository';
import { auditRepository } from '@/server/repositories/audit.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { userRepository } from '@/server/repositories/user.repository';
import type { RequestMeta } from '@/server/http/request';
import { cleanReviewText } from './review.service';
import { hasRole, type CurrentUser } from './session.service';

/** «همکاری در فروش» policy. All limits in one place. */
export const AFFILIATE_POLICY = {
  descriptionMin: 20,
  descriptionMax: 1000,
  perUserPerHour: 5,
  perIpPerHour: 5,
  /** after a rejection, a new application only after this many days */
  retryAfterDays: 7,
} as const;

export const PROVINCES = [
  'آذربایجان شرقی',
  'آذربایجان غربی',
  'اردبیل',
  'اصفهان',
  'البرز',
  'ایلام',
  'بوشهر',
  'تهران',
  'چهارمحال و بختیاری',
  'خراسان جنوبی',
  'خراسان رضوی',
  'خراسان شمالی',
  'خوزستان',
  'زنجان',
  'سمنان',
  'سیستان و بلوچستان',
  'فارس',
  'قزوین',
  'قم',
  'کردستان',
  'کرمان',
  'کرمانشاه',
  'کهگیلویه و بویراحمد',
  'گلستان',
  'گیلان',
  'لرستان',
  'مازندران',
  'مرکزی',
  'هرمزگان',
  'همدان',
  'یزد',
] as const;

export const CHANNEL_TYPES: Record<ChannelType, string> = {
  instagram: 'اینستاگرام',
  telegram: 'تلگرام',
  store: 'فروشگاه حضوری',
  website: 'وب‌سایت',
  other: 'سایر',
};

export const FOLLOWERS: Record<Followers, string> = {
  lt1k: 'کمتر از ۱ هزار',
  '1k-10k': '۱ تا ۱۰ هزار',
  '10k-50k': '۱۰ تا ۵۰ هزار',
  '50k-100k': '۵۰ تا ۱۰۰ هزار',
  gt100k: 'بیشتر از ۱۰۰ هزار',
};

const SOURCES = ['home', 'footer', 'account', 'direct'] as const satisfies readonly AffiliateSource[];

/** One line of untrusted text: plain text (cleanReviewText), no line breaks. */
const line = (s: string) => cleanReviewText(s).replace(/\s+/g, ' ');

/**
 * Where the applicant sells: an @handle (Instagram/Telegram) or a web address. Stored as plain text in one of
 * two shapes: "@name" or "https://host/path" (http(s) only; no other scheme, no credentials).
 */
export function normalizeChannel(input: string): string | null {
  const v = line(input);
  if (/^@[A-Za-z0-9._]{2,40}$/.test(v)) return v; // @name
  if (/^[A-Za-z0-9_]{2,40}$/.test(v) && !/^\d+$/.test(v)) return `@${v}`; // name without @ (no dot: not a host)
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname.includes('.'))
    return null;
  const out = `https://${url.hostname}${url.pathname === '/' ? '' : url.pathname}${url.search}`;
  return out.length <= 200 ? out : null;
}

const required = (label: string, min: number, max: number) =>
  z
    .string({ message: `${label} را وارد کنید.` })
    .transform(line)
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? `${label} را وارد کنید.` : `${label} حداقل ${min} حرف باشد.`)
        .max(max, `${label} حداکثر ${max} حرف باشد.`),
    );

const applicationSchema = z.object({
  fullName: required('نام و نام خانوادگی', 3, 80),
  province: z.enum(PROVINCES, { message: 'استان را انتخاب کنید.' }),
  city: required('شهر', 2, 60),
  channelType: z.enum(Object.keys(CHANNEL_TYPES) as [ChannelType, ...ChannelType[]], {
    message: 'نوع کانال فروش را انتخاب کنید.',
  }),
  channelUrl: z.string({ message: 'نشانی اینستاگرام یا کانال فروش را وارد کنید.' }).transform((v, ctx) => {
    const n = normalizeChannel(v);
    if (!n) {
      ctx.addIssue({
        code: 'custom',
        message: 'نشانی کانال را به‌صورت ‎@نام‌کاربری یا آدرس سایت (مثل instagram.com/…) وارد کنید.',
      });
      return z.NEVER;
    }
    return n;
  }),
  followers: z
    .enum(Object.keys(FOLLOWERS) as [Followers, ...Followers[]])
    .optional()
    .catch(undefined),
  description: z
    .string({ message: 'توضیح نحوه‌ی فروش را بنویسید.' })
    .transform(cleanReviewText)
    .pipe(
      z
        .string()
        .min(AFFILIATE_POLICY.descriptionMin, `توضیح حداقل ${AFFILIATE_POLICY.descriptionMin} حرف باشد.`)
        .max(AFFILIATE_POLICY.descriptionMax, `توضیح حداکثر ${AFFILIATE_POLICY.descriptionMax} حرف باشد.`),
    ),
  terms: z.literal('1', { message: 'شرایط همکاری را بپذیرید.' }),
  source: z.enum(SOURCES).catch('direct'),
});

const isAffiliate = (user: CurrentUser) => user.roles.includes('affiliate');

export const affiliateService = {
  /** The signed-in user's state on the page: already a seller, or their latest application (if any). */
  async statusFor(user: CurrentUser) {
    if (isAffiliate(user)) return { kind: 'affiliate' as const };
    const latest = await affiliateRepository.latestFor(user.id);
    if (!latest) return { kind: 'none' as const };
    if (latest.status === 'rejected') {
      const retryAt = new Date(latest.created_at.getTime() + AFFILIATE_POLICY.retryAfterDays * 86_400_000);
      return { kind: 'rejected' as const, application: latest, retryAt, canRetry: retryAt <= new Date() };
    }
    return { kind: latest.status, application: latest };
  },

  /** Stores an application as «در انتظار بررسی». One pending per user; none while already a seller. */
  async submit(user: CurrentUser, input: Record<string, unknown>, meta: RequestMeta) {
    const parsed = applicationSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('INVALID_DATA', { message: parsed.error.issues[0]?.message });
    }
    if (isAffiliate(user)) {
      throw new AppError('CONFLICT', { message: 'شما در حال حاضر فروشنده‌ی همکار هستید.' });
    }
    const a = parsed.data;
    return withTransaction(async (db) => {
      const latest = await affiliateRepository.latestFor(user.id, db);
      if (latest?.status === 'pending') {
        throw new AppError('CONFLICT', { message: 'درخواست قبلی شما در حال بررسی است.' });
      }
      if (
        latest?.status === 'rejected' &&
        Date.now() - latest.created_at.getTime() < AFFILIATE_POLICY.retryAfterDays * 86_400_000
      ) {
        throw new AppError('CONFLICT', {
          message: `درخواست قبلی شما رد شده است؛ ${AFFILIATE_POLICY.retryAfterDays} روز بعد از آن می‌توانید دوباره درخواست بدهید.`,
        });
      }
      const recent = await affiliateRepository.recent(user.id, meta.ip, 3600, db);
      if (recent.byUser >= AFFILIATE_POLICY.perUserPerHour || recent.byIp >= AFFILIATE_POLICY.perIpPerHour) {
        throw new AppError('RATE_LIMITED');
      }
      const { id } = await affiliateRepository
        .insert(
          {
            userId: user.id,
            fullName: a.fullName,
            phone: user.phone,
            province: a.province,
            city: a.city,
            channelType: a.channelType,
            channelUrl: a.channelUrl,
            followers: a.followers ?? null,
            description: a.description,
            source: a.source,
            ip: meta.ip,
          },
          db,
        )
        .catch((e) => {
          // two submits at once: the unique index keeps one pending application
          if (e instanceof AppError && e.code === 'CONFLICT') {
            throw new AppError('CONFLICT', { message: 'درخواست قبلی شما در حال بررسی است.' });
          }
          throw e;
        });
      await auditRepository.record(
        {
          actorUserId: user.id,
          action: 'affiliate.apply',
          entityType: 'affiliate_application',
          entityId: id,
          meta: { source: a.source, channelType: a.channelType },
          ip: meta.ip,
        },
        db,
      );
      return { id, status: 'pending' as const };
    });
  },

  /** Admin: approve (grants the 'affiliate' role, same transaction) or reject a pending application. */
  async decide(
    admin: CurrentUser,
    id: string,
    decision: 'approved' | 'rejected',
    reason: string,
    meta: RequestMeta,
  ) {
    if (!hasRole(admin, 'admin')) throw new AppError('FORBIDDEN');
    if (!/^\d{1,18}$/.test(id)) throw new AppError('INVALID_DATA');
    const why = decision === 'rejected' ? line(reason).slice(0, 300) || null : null;
    return withTransaction(async (db) => {
      const row = await affiliateRepository.decide(id, decision, admin.id, why, db);
      if (!row) throw new AppError('NOT_FOUND');
      let granted = false;
      if (decision === 'approved') {
        granted = await userRepository.grantRole(db, row.user_id, 'affiliate', admin.id);
        if (granted) {
          await auditRepository.record(
            {
              actorUserId: admin.id,
              action: 'role.grant',
              entityType: 'user',
              entityId: row.user_id,
              meta: { role: 'affiliate', applicationId: id },
              ip: meta.ip,
            },
            db,
          );
        }
      }
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: `affiliate.${decision === 'approved' ? 'approve' : 'reject'}`,
          entityType: 'affiliate_application',
          entityId: id,
          meta: { userId: row.user_id },
          ip: meta.ip,
        },
        db,
      );
      return { ...row, granted };
    });
  },

  list: (status: AffiliateStatus, limit = 100) => affiliateRepository.list(status, limit),
  counts: () => affiliateRepository.counts(),
};
