import 'server-only';
import { getConfig } from '@/lib/config';
import { siteSettingsRepository } from '@/server/repositories/site-settings.repository';

export const BLOCK_INDEXING_KEY = 'seo.block_indexing';
const MAX_AGE_MS = 60_000;
let cached: { blocked: boolean; at: number } | null = null;

/**
 * Whether search engines are kept out (meta robots, robots.txt, sitemap, X-Robots-Tag): always outside production
 * (staging, development — whatever the admin switch says), in production the admin's «جلوگیری از ایندکس شدن»
 * (default on). Cached a minute; on a database error it stays blocked (never opens the site by accident).
 * Kept apart from the settings service so proxy.ts can use it without the sign-in code.
 */
export async function indexingBlocked(): Promise<boolean> {
  if (getConfig().APP_ENV !== 'production') return true;
  if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.blocked;
  let blocked = true;
  try {
    blocked = (await siteSettingsRepository.get([BLOCK_INDEXING_KEY])).get(BLOCK_INDEXING_KEY) !== false;
  } catch {
    blocked = true;
  }
  cached = { blocked, at: Date.now() };
  return blocked;
}

/** after the admin changed the switch */
export function forgetIndexingPolicy(): void {
  cached = null;
}
