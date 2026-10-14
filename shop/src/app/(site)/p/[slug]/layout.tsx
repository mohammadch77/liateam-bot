import type { ReactNode } from 'react';
import { catalogService } from '@/server/services/catalog.service';
import { enforceCanonical } from '../../_catalog/canonical';

export default async function ProductLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  await enforceCanonical((await params).slug, catalogService.productRef);
  return children;
}
