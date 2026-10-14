import { Container, ProductCardSkeleton, ProductGrid, Skeleton } from '@/ui';
import s from './catalog.module.css';

/** Shown by loading.tsx while a listing page renders on the server. */
export function ListingSkeleton({ withSidebar = true }: { withSidebar?: boolean }) {
  return (
    <Container className={s.page}>
      <Skeleton width={220} height={14} />
      <Skeleton width={180} height={30} radius={8} />
      <div className={s.layout}>
        {withSidebar && (
          <div className={s.sidebar}>
            <Skeleton height={320} radius={14} />
          </div>
        )}
        <div className={s.results}>
          <Skeleton width={120} height={16} />
          <ProductGrid withSidebar={withSidebar}>
            {Array.from({ length: 8 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </ProductGrid>
        </div>
      </div>
    </Container>
  );
}
