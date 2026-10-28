import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';

/**
 * Liateam's provinces and cities (migration 017), copied here on demand: the shop cannot call Liateam, so a list is asked
 * of the sync bot's «geo» job through shop_enqueue_geo / shop_geo_result (deploy/shop-db-roles-017-geo.sql) and kept.
 */
export type GeoItem = { id: number; name: string };

export const geoRepository = {
  async provinces(db?: Queryable): Promise<{ items: GeoItem[]; fetchedAt: Date | null }> {
    const rows = await query<GeoItem & { fetched_at: Date }>(
      'geo.provinces',
      'SELECT id, name, fetched_at FROM geo_provinces ORDER BY name',
      [],
      db,
    );
    return {
      items: rows.map(({ id, name }) => ({ id, name })),
      fetchedAt: rows.length ? new Date(Math.min(...rows.map((r) => r.fetched_at.getTime()))) : null,
    };
  },

  async cities(provinceId: number, db?: Queryable): Promise<{ items: GeoItem[]; fetchedAt: Date | null }> {
    const rows = await query<GeoItem & { fetched_at: Date }>(
      'geo.cities',
      'SELECT id, name, fetched_at FROM geo_cities WHERE province_id = $1 ORDER BY name',
      [provinceId],
      db,
    );
    return {
      items: rows.map(({ id, name }) => ({ id, name })),
      fetchedAt: rows.length ? new Date(Math.min(...rows.map((r) => r.fetched_at.getTime()))) : null,
    };
  },

  /** Name of a city of a province (the address snapshot keeps names and Liateam's ids). */
  async cityName(
    provinceId: number,
    cityId: number,
    db?: Queryable,
  ): Promise<{ province: string; city: string } | null> {
    return queryOne<{ province: string; city: string }>(
      'geo.city_name',
      `SELECT p.name AS province, c.name AS city FROM geo_cities c JOIN geo_provinces p ON p.id = c.province_id
        WHERE c.id = $2 AND p.id = $1`,
      [provinceId, cityId],
      db,
    );
  },

  async saveProvinces(items: readonly GeoItem[], db?: Queryable): Promise<void> {
    for (const p of items) {
      await query(
        'geo.save_province',
        `INSERT INTO geo_provinces (id, name, fetched_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, fetched_at = now()`,
        [p.id, p.name.slice(0, 80)],
        db,
      );
    }
  },

  async saveCities(provinceId: number, items: readonly GeoItem[], db?: Queryable): Promise<void> {
    for (const c of items) {
      await query(
        'geo.save_city',
        `INSERT INTO geo_cities (id, province_id, name, fetched_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (id) DO UPDATE SET province_id = EXCLUDED.province_id, name = EXCLUDED.name, fetched_at = now()`,
        [c.id, provinceId, c.name.slice(0, 80)],
        db,
      );
    }
  },

  /** Asks the bot for the provinces (null) or the cities of one province; returns the job id. */
  async enqueue(provinceId: number | null, db?: Queryable): Promise<number> {
    const row = await queryOne<{ id: number }>(
      'geo.enqueue',
      'SELECT public.shop_enqueue_geo($1::int) AS id',
      [provinceId],
      db,
    );
    return row!.id;
  },

  async result(
    jobId: number,
    db?: Queryable,
  ): Promise<{ done: boolean; ok: boolean; result: unknown } | null> {
    return queryOne(
      'geo.result',
      'SELECT done, ok, result FROM public.shop_geo_result($1::int)',
      [jobId],
      db,
    );
  },
};
