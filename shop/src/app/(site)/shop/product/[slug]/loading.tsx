import { Container, Skeleton } from '@/ui';
import s from './product.module.css';

/**
 * Shown while the product streams in. At least a screen tall, so the footer starts below the fold and does not jump
 * down when the page arrives (it did: desktop CLS 0.128 on product pages).
 */
export default function Loading() {
  return (
    <Container className={`${s.page} ${s.loadingPage}`}>
      <Skeleton width={260} height={14} />
      <div className={s.product}>
        <Skeleton height="min(92vw, 560px)" radius={24} />
        <div className={s.info}>
          <Skeleton width={90} height={14} />
          <Skeleton width="90%" height={28} radius={8} />
          <Skeleton width="60%" height={28} radius={8} />
          <Skeleton height={220} radius={20} />
        </div>
      </div>
    </Container>
  );
}
