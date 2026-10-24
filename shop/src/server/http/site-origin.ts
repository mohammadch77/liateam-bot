import 'server-only';
import { headers } from 'next/headers';

/** The address this request came in on (behind nginx: its Host and scheme). */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const local = host.startsWith('localhost') || host.startsWith('127.');
  const proto = h.get('x-forwarded-proto') ?? (local ? 'http' : 'https');
  return `${proto}://${host}`;
}
