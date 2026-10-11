// Test API – credit the simulated wallet:  POST {"mobile": "09…", "amount": 5000000}  (RIAL)
import { apiUser, readJson, unauthorized, badRequest } from '@/lib/apiUser';
import { jobResponse } from '@/lib/orders';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const b = await readJson(req);
  if (!b) return badRequest();
  return jobResponse('topup', { mobile: b.mobile, amount: b.amount }, `dashboard:${user}`);
}
