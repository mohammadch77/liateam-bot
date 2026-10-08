import { getProducts, getCategories } from '@/lib/data';
import DbError from '../../components/DbError';
import ProductsTable from './ProductsTable';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  let products, categories;
  try {
    [products, categories] = await Promise.all([getProducts(), getCategories()]);
  } catch (e) {
    return <DbError error={e} />;
  }
  return <ProductsTable products={products.map((p) => ({ ...p, updated_at: p.updated_at.toISOString() }))} categories={categories} />;
}
