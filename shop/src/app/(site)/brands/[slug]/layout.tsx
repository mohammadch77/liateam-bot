import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { catalogService } from '@/server/services/catalog.service';

/** A real 404 for an unknown brand, decided before the page streams behind its skeleton (loading.tsx). */
export default async function BrandLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brands = await catalogService.brands().catch(() => null);
  // catalog down: let the page show its «unavailable» state instead of a misleading 404
  if (brands && !brands.some((b) => b.slug === slug)) notFound();
  return children;
}
