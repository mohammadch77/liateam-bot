// Test API – the customer paid: create a queued shop order from a fresh review.
//   POST {"review_id": 12, "payment": "wallet" | "gateway",
//         "customer": {"first_name","last_name","mobile"},
//         "address": {"province_id","city_id","postal_code","address","plate","unit"}}
// "gateway" simulates a successful bank payment on our site; "wallet" spends the simulated wallet.
import { apiUser, readJson, unauthorized, badRequest } from '@/lib/apiUser';
import { jobResponse } from '@/lib/orders';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const b = await readJson(req);
  if (!b) return badRequest();
  return jobResponse('create', { review_id: b.review_id, payment: b.payment, customer: b.customer, address: b.address }, `dashboard:${user}`);
}
