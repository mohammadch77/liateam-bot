// A stand-in for the sync bot's order service in tests: answers the shop's «review» and «geo» jobs in public.order_jobs the
// way src/orders.mjs does (same result shape), from the local database. The real bot reads Liateam live; this one reads
// product_catalog, so a scenario can make a product unavailable, short, or dearer, or stay silent (a timeout).
//
//   const bot = startResponder();      bot.mode.out = new Set([541]);      … await bot.stop();
//
// Only jobs with requested_by = 'shop' are touched. Everything the test changed (a price) is put back by stop().
import { sql } from './_harness.mjs';

const hex = (s) => `convert_from(decode('${Buffer.from(s, 'utf8').toString('hex')}', 'hex'), 'UTF8')`;
const SHIPPING = 187_900;

export const GEO = {
  provinces: [
    { id: 1, name: 'تهران' },
    { id: 2, name: 'اصفهان' },
  ],
  cities: {
    1: [
      { id: 5, name: 'تهران' },
      { id: 6, name: 'ری' },
    ],
    2: [{ id: 7, name: 'اصفهان' }],
  },
};

const json = (list) =>
  `(SELECT jsonb_agg(jsonb_build_object('id', v.id, 'name', ${'v.name'})) FROM (VALUES ${list
    .map((x) => `(${x.id}, ${hex(x.name)})`)
    .join(',')}) AS v(id, name))`;

export function startResponder() {
  const bot = {
    /** out: Set of product ids that are gone · adjust: Map id → units available · priceUp: Map id → new Liateam price
     *  silent: do not answer (a timeout) · failGeo: answer the geo job with an error · expiresInSeconds: the hold */
    mode: { out: new Set(), adjust: new Map(), priceUp: new Map(), silent: false, failGeo: false, expiresInSeconds: 900 },
    answered: [],
    restore: new Map(), // product id → its price before the test moved it
    stopped: false,
    async stop() {
      this.stopped = true;
      await this.loop;
      for (const [id, price] of this.restore) sql(`update supplier_products set price = ${price} where id = ${id}`);
    },
    loop: Promise.resolve(),
  };

  const answer = (id, ok, resultSql) =>
    sql(`update order_jobs set picked_at = now(), done_at = now(), ok = ${ok}, result = ${resultSql} where id = ${id} and done_at is null`);

  function review(job) {
    const m = bot.mode;
    const items = job.payload.items;
    const ids = items.map((i) => i.product_id).join(',');
    const rows = Object.fromEntries(
      sql(`select string_agg(id || ':' || price || ':' || stock, ',') from product_catalog where id in (${ids})`)
        .split(',')
        .filter(Boolean)
        .map((r) => r.split(':').map(Number))
        .map(([id, price, stock]) => [id, { price, stock }]),
    );
    const lines = items.map((i) => {
      const live = rows[i.product_id];
      if (!live || m.out.has(i.product_id) || live.stock <= 0) {
        return { id: i.product_id, requested: i.quantity, q: 0, status: 'unavailable', price: live?.price ?? 0, old: live?.price ?? 0 };
      }
      const price = m.priceUp.get(i.product_id) ?? live.price;
      const cap = Math.min(i.quantity, m.adjust.get(i.product_id) ?? live.stock);
      return {
        id: i.product_id,
        requested: i.quantity,
        q: cap,
        status: cap === 0 ? 'unavailable' : cap < i.quantity ? 'adjusted' : 'ok',
        price,
        old: live.price,
      };
    });
    for (const l of lines) {
      if (l.price !== l.old && !bot.restore.has(l.id)) bot.restore.set(l.id, l.old);
      if (l.price !== l.old) sql(`update supplier_products set price = ${l.price} where id = ${l.id}`); // the bot applies a changed price
    }
    const placeable = lines.some((l) => l.q > 0);
    const goods = lines.reduce((t, l) => t + l.price * l.q, 0);
    const values = lines.map((l) => `(${l.id}, ${l.requested}, ${l.q}, '${l.status}', ${l.price}, ${l.old})`).join(',');
    const result = `jsonb_build_object(
      'ok', ${placeable}, 'reason', ${placeable ? 'NULL' : hex('هیچ‌کدام از اقلام سبد موجود نیست')}, 'city_id', ${job.payload.city_id},
      'items', (SELECT jsonb_agg(jsonb_build_object('product_id', v.id, 'name', p.name, 'requested', v.req, 'quantity', v.q, 'status', v.st,
                 'unit_price', v.price, 'line_total', v.price * v.q,
                 'price_changed', CASE WHEN v.price <> v.old THEN jsonb_build_object('old', v.old, 'new', v.price) END, 'limited', false))
                FROM (VALUES ${values}) AS v(id, req, q, st, price, old) JOIN product_catalog p ON p.id = v.id),
      'alternatives', '{}'::jsonb,
      'shipping', jsonb_build_object('price', ${SHIPPING}, 'title', ${hex('پست')}),
      'items_total', ${goods}, 'total', ${goods + SHIPPING}, 'urgent', false,
      'expires_at', to_char((now() at time zone 'utc') + interval '${m.expiresInSeconds} seconds', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))`;
    answer(job.id, true, result);
    bot.answered.push({ id: job.id, kind: 'review', items: lines });
  }

  function geo(job) {
    if (bot.mode.failGeo) return answer(job.id, false, `jsonb_build_object('error', 'down')`);
    const list = job.payload.province_id ? (GEO.cities[job.payload.province_id] ?? []) : GEO.provinces;
    answer(job.id, true, json(list));
    bot.answered.push({ id: job.id, kind: 'geo' });
  }

  bot.loop = (async () => {
    while (!bot.stopped) {
      try {
        if (!bot.mode.silent) {
          const raw = sql(
            `select coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'payload', payload) order by id), '[]') from order_jobs
              where picked_at is null and done_at is null and requested_by = 'shop' and kind in ('review', 'geo')`,
          );
          for (const job of JSON.parse(raw)) (job.kind === 'review' ? review : geo)(job);
        }
      } catch (e) {
        console.error('responder:', e.message.split('\n')[0]);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
  return bot;
}
