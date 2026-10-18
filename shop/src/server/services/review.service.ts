import 'server-only';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { auditRepository } from '@/server/repositories/audit.repository';
import { catalogRepository } from '@/server/repositories/catalog.repository';
import { reviewRepository } from '@/server/repositories/review.repository';
import { withTransaction } from '@/server/repositories/transaction';
import type { RequestMeta } from '@/server/http/request';
import type { CurrentUser } from './session.service';

/** Review policy. All limits in one place. */
export const REVIEW_POLICY = {
  minLength: 10,
  maxLength: 1000,
  perUserPerHour: 3,
  perUserPerDay: 10,
} as const;

/**
 * Untrusted text → plain text: markup, control/bidi-override characters and repeated whitespace removed. The
 * result is always rendered as a text node (never HTML), so this is defence in depth, and keeps the stored
 * text clean for the moderators.
 */
export function cleanReviewText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const reviewSchema = z.object({
  productId: z.coerce.number().int().positive().max(999_999_999),
  rating: z.coerce
    .number({ message: 'امتیاز را انتخاب کنید.' })
    .int()
    .min(1, 'امتیاز را انتخاب کنید.')
    .max(5, 'امتیاز را انتخاب کنید.'),
  body: z
    .string()
    .transform(cleanReviewText)
    .pipe(
      z
        .string()
        .min(REVIEW_POLICY.minLength, `متن دیدگاه حداقل ${REVIEW_POLICY.minLength} حرف باشد.`)
        .max(REVIEW_POLICY.maxLength, `متن دیدگاه حداکثر ${REVIEW_POLICY.maxLength} حرف باشد.`),
    ),
});

/** "مریم احمدی" → "مریم ا." (as Liateam's synced reviews are shown); no name → null («کاربر»). */
export function shortName(fullName: string | null): string | null {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const [first = '', last = ''] = [words[0], words.at(-1)];
  return (words.length === 1 ? first : `${first} ${[...last][0] ?? ''}.`).slice(0, 40);
}

export const reviewService = {
  /** Stores a review as «در انتظار تأیید»; it is shown only after an admin approves it. */
  async submit(user: CurrentUser, input: Record<string, unknown>, meta: RequestMeta) {
    const parsed = reviewSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('INVALID_DATA', { message: parsed.error.issues[0]?.message });
    }
    const { productId, rating, body } = parsed.data;
    if (!(await catalogRepository.getProductSlug(productId))) throw new AppError('NOT_FOUND');
    return withTransaction(async (db) => {
      const hour = await reviewRepository.recentByUser(user.id, productId, 3600, db);
      if (hour.pending) {
        throw new AppError('CONFLICT', { message: 'دیدگاه قبلی شما برای این محصول در انتظار تأیید است.' });
      }
      const day = await reviewRepository.recentByUser(user.id, productId, 86400, db);
      if (hour.recent >= REVIEW_POLICY.perUserPerHour || day.recent >= REVIEW_POLICY.perUserPerDay) {
        throw new AppError('RATE_LIMITED');
      }
      const { id } = await reviewRepository.insert(
        { productId, userId: user.id, authorName: shortName(user.fullName), rating, body, ip: meta.ip },
        db,
      );
      await auditRepository.record(
        {
          actorUserId: user.id,
          action: 'review.submit',
          entityType: 'site_review',
          entityId: id,
          meta: { productId },
          ip: meta.ip,
        },
        db,
      );
      return { id, status: 'pending' as const };
    });
  },

  async moderate(admin: CurrentUser, id: string, status: 'approved' | 'rejected', meta: RequestMeta) {
    if (!/^\d{1,18}$/.test(id)) throw new AppError('INVALID_DATA');
    return withTransaction(async (db) => {
      const row = await reviewRepository.moderate(id, status, admin.id, db);
      if (!row) throw new AppError('NOT_FOUND');
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: `review.${status === 'approved' ? 'approve' : 'reject'}`,
          entityType: 'site_review',
          entityId: id,
          meta: { productId: row.product_id },
          ip: meta.ip,
        },
        db,
      );
      return row;
    });
  },

  pending: (limit = 50) => reviewRepository.pending(limit),
};
