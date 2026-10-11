// Test API – Liateam provinces (no parameter) or the cities of one province (?province_id=11).
import { apiUser, unauthorized } from '@/lib/apiUser';
import { jobResponse } from '@/lib/orders';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const province = req.nextUrl.searchParams.get('province_id');
  return jobResponse('geo', province ? { province_id: province } : {}, `dashboard:${user}`);
}
