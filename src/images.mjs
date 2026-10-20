import { insertEvents, productEvent } from './change-events.mjs';

// Do our product photos still exist on Liateam's image host? Liateam sometimes replaces a photo and the old address
// starts answering 404 (product 426's main photo); the shop would then show a broken image. A light HEAD per address,
// a few per run with a pause between them (the bot's usual pace), results kept in image_checks and re-checked weekly.
// The photo the shop shows is chosen from them: the main one if it is not known broken, else the first gallery photo
// not known broken, else none (the shop draws its placeholder).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HTTP answer → true (exists), false (gone: 404/410/403), null (unknown: network error, 5xx — decide later). */
export function classifyStatus(status) {
  if (status >= 200 && status < 300) return true;
  if (status === 404 || status === 410 || status === 403) return false;
  return null;
}

/**
 * The photo to show: the main one unless it is known broken, else the first gallery photo not known broken, else
 * null. Unknown (not yet checked) counts as fine, so nothing disappears before it was checked.
 * @param {string|null} main  @param {string[]} gallery  @param {Set<string>} broken
 */
export function resolveImage(main, gallery, broken) {
  if (main && !broken.has(main)) return main;
  return gallery.find((u) => u && !broken.has(u)) ?? null;
}

/** HEAD one address (GET of the first byte when HEAD is refused). */
async function probe(url) {
  const opts = { redirect: 'follow', signal: AbortSignal.timeout(10_000) };
  try {
    let res = await fetch(url, { ...opts, method: 'HEAD' });
    if (res.status === 405 || res.status === 501) res = await fetch(url, { ...opts, headers: { Range: 'bytes=0-0' } });
    return res.status;
  } catch {
    return null;
  }
}

/**
 * Checks up to `limit` photo addresses: never checked first, then those checked more than `maxAgeDays` ago.
 * 0.8–2 s pause before each. Unknown answers are not stored (retried next run).
 * @returns {{ checked: number, broken: number }}
 */
export async function checkImages(db, { limit = 60, maxAgeDays = 7, pause = () => 800 + Math.random() * 1200 } = {}) {
  const { rows } = await db.query(
    `WITH urls AS (
       SELECT image_url AS url FROM supplier_products WHERE missing_since IS NULL AND image_url IS NOT NULL
       UNION SELECT i.url FROM product_images i JOIN supplier_products p ON p.id = i.product_id WHERE p.missing_since IS NULL)
     SELECT u.url FROM urls u LEFT JOIN image_checks c ON c.url = u.url
      WHERE c.url IS NULL OR c.checked_at < now() - make_interval(days => $2)
      ORDER BY c.checked_at NULLS FIRST, u.url
      LIMIT $1`,
    [limit, maxAgeDays]);
  let checked = 0, broken = 0;
  for (const { url } of rows) {
    await sleep(pause());
    const status = await probe(url);
    const ok = status === null ? null : classifyStatus(status);
    if (ok === null) continue;
    checked++;
    if (!ok) broken++;
    await db.query(
      `INSERT INTO image_checks (url, ok, status, checked_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (url) DO UPDATE SET ok = $2, status = $3, checked_at = now()`,
      [url, ok, status]);
  }
  return { checked, broken };
}

/**
 * Applies the checks: each product's shown photo (display_image_url) and each gallery photo's ok flag.
 * Rows are written only when they change. @returns {{ replaced: number, none: number }}
 */
export async function applyImageChecks(db) {
  const { rows: bad } = await db.query('SELECT url FROM image_checks WHERE NOT ok');
  const broken = new Set(bad.map((r) => r.url));
  await db.query(
    `UPDATE product_images i SET ok = c.ok FROM image_checks c WHERE c.url = i.url AND i.ok IS DISTINCT FROM c.ok`);
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.image_url, p.display_image_url, p.image_checked,
            COALESCE((SELECT array_agg(url ORDER BY position) FROM product_images WHERE product_id = p.id), '{}') AS gallery
       FROM supplier_products p WHERE p.missing_since IS NULL`);
  let replaced = 0, none = 0;
  for (const r of rows) {
    const shown = resolveImage(r.image_url, r.gallery, broken);
    if (shown !== r.image_url) replaced++;
    if (!shown) none++;
    if (shown !== r.display_image_url || !r.image_checked) {
      await db.query('BEGIN');
      try {
        await db.query('UPDATE supplier_products SET display_image_url = $2, image_checked = true WHERE id = $1', [r.id, shown]);
        // the photo the shop shows changed (not its first pick): one event, in the same transaction
        if (r.image_checked) await insertEvents(db, [productEvent(r.id, r.name, 'images_changed', { has_photo: !!shown })]);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    }
  }
  return { replaced, none };
}
