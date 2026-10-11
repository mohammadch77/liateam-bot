// Test API – "order review": live stock and price from Liateam for a basket, before the customer pays.
//   POST {"city_id": 208, "items": [{"product_id": 544, "quantity": 1}]}
// The answer's job_id is the review id to pass to /api/test/orders (valid 15 minutes, single use).
// While valid, its quantities are held for this customer (cinema-style). Reviewing again? Pass the old
// id as "replaces_review_id" so the previous hold is released.
import { apiUser, readJson, unauthorized, badRequest } from '@/lib/apiUser';
import { jobResponse } from '@/lib/orders';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const body = await readJson(req);
  if (!body) return badRequest();
  return jobResponse('review', { city_id: body.city_id, items: body.items, replaces_review_id: body.replaces_review_id }, `dashboard:${user}`);
}
