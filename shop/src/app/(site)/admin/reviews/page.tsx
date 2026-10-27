import type { Metadata } from 'next';
import Link from 'next/link';
import { productPath } from '@/lib/urls';
import { toFaDigits } from '@/lib/format/number';
import { requireRole } from '@/server/auth/guards';
import { reviewService } from '@/server/services/review.service';
import { Alert, Breadcrumb, Button, Container, EmptyState } from '@/ui';
import s from '../../account/account.module.css';
import { moderateReviewAction } from './actions';

export const metadata: Metadata = { title: 'دیدگاه‌های در انتظار تأیید', robots: { index: false } };

const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });

/** Moderation queue: site reviews are shown on the product page only after an admin approves them. */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/reviews');
  const [pending, sp] = await Promise.all([reviewService.pending(), searchParams]);

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت', href: '/admin' }, { label: 'دیدگاه‌ها' }]}
      />
      <section className={s.card} aria-labelledby="reviews-title" style={{ maxWidth: 'none' }}>
        <h1 id="reviews-title" className={s.title}>
          دیدگاه‌های در انتظار تأیید ({toFaDigits(pending.length)})
        </h1>
        {sp.done && <Alert tone="success">انجام شد.</Alert>}
        {sp.error && <Alert tone="danger">این دیدگاه پیدا نشد یا قبلاً بررسی شده است.</Alert>}
        {pending.length === 0 ? (
          <EmptyState icon="check_circle" title="دیدگاهی در انتظار تأیید نیست." />
        ) : (
          <dl className={s.list}>
            {pending.map((r) => (
              <div key={r.id}>
                <dt>
                  {timeFa.format(r.created_at)} · {r.author_name ?? 'کاربر'} · {toFaDigits(r.rating)} از ۵ ·{' '}
                  <Link href={productPath(r.product_id, null)}>محصول {toFaDigits(r.product_id)}</Link>
                </dt>
                <dd>
                  <p style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{r.body}</p>
                  <form action={moderateReviewAction} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" name="decision" value="approve" size="sm">
                      تأیید
                    </Button>
                    <Button type="submit" name="decision" value="reject" size="sm" variant="outline">
                      رد
                    </Button>
                  </form>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </Container>
  );
}
