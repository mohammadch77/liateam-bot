import type { ReactNode } from 'react';
import { catalogService } from '@/server/services/catalog.service';
import { enforceCanonical } from '../../_catalog/canonical';

export default async function CategoryLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  await enforceCanonical((await params).slug, catalogService.categoryRef);
  return children;
}
