import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { geoRepository, type GeoItem } from '@/server/repositories/geo.repository';

/**
 * Liateam's provinces and cities for the address form. They are kept in the shop's database; the first time (or after a
 * week) the sync bot is asked for them through its «geo» job — the shop cannot call Liateam itself. A stale list is served
 * at once and refreshed in the background; with no list at all the request waits for the bot for a few seconds and then
 * says the supplier connection is unavailable.
 */
const FRESH_MS = 7 * 24 * 3600_000;
const WAIT_MS = 12_000;
const POLL_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const unavailable = () =>
  new AppError('DB_UNAVAILABLE', {
    message: 'اتصال به سامانه‌ی تأمین‌کننده برقرار نشد. چند لحظه بعد دوباره تلاش کنید.',
  });

function parseList(result: unknown): GeoItem[] {
  const raw = Array.isArray(result) ? result : [];
  const items = raw
    .map((x) => ({
      id: Number((x as { id?: unknown }).id),
      name: String((x as { name?: unknown }).name ?? '').trim(),
    }))
    .filter((x) => Number.isInteger(x.id) && x.id > 0 && x.name.length > 0);
  if (!items.length) throw unavailable();
  return items;
}

/** Asks the bot and waits for the answer (never more than WAIT_MS). */
async function fromBot(provinceId: number | null): Promise<GeoItem[]> {
  const jobId = await geoRepository.enqueue(provinceId);
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    const r = await geoRepository.result(jobId);
    if (r?.done) {
      if (!r.ok) throw unavailable();
      return parseList(r.result);
    }
    await sleep(POLL_MS);
  }
  logger.warn('geo.bot_timeout', { province: provinceId });
  throw unavailable();
}

const stale = (at: Date | null) => !at || Date.now() - at.getTime() > FRESH_MS;

export const geoService = {
  async provinces(): Promise<GeoItem[]> {
    const have = await geoRepository.provinces();
    if (have.items.length && !stale(have.fetchedAt)) return have.items;
    const refresh = async () => geoRepository.saveProvinces(await fromBot(null));
    if (have.items.length) {
      void refresh().catch((e) => logger.warn('geo.refresh_failed', { err: e }));
      return have.items;
    }
    await refresh();
    return (await geoRepository.provinces()).items;
  },

  async cities(provinceId: number): Promise<GeoItem[]> {
    if (!Number.isInteger(provinceId) || provinceId <= 0) throw new AppError('INVALID_DATA');
    const provinces = await this.provinces();
    if (!provinces.some((p) => p.id === provinceId))
      throw new AppError('INVALID_REFERENCE', { message: 'استان معتبر نیست.' });
    const have = await geoRepository.cities(provinceId);
    if (have.items.length && !stale(have.fetchedAt)) return have.items;
    const refresh = async () => geoRepository.saveCities(provinceId, await fromBot(provinceId));
    if (have.items.length) {
      void refresh().catch((e) => logger.warn('geo.refresh_failed', { err: e }));
      return have.items;
    }
    await refresh();
    return (await geoRepository.cities(provinceId)).items;
  },
};
