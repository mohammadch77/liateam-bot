import type { CSSProperties } from 'react';

type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
};

/** Grey placeholder block (ProductCard skeleton colours); shimmer stops under prefers-reduced-motion. */
export function Skeleton({ width = '100%', height = 12, radius = 6, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background:
          'linear-gradient(100deg, var(--color-skeleton-block) 30%, var(--color-skeleton-b) 50%, var(--color-skeleton-block) 70%)',
        backgroundSize: '200% 100%',
        animation: 'av-shimmer 1.4s linear infinite',
        ...style,
      }}
    />
  );
}
