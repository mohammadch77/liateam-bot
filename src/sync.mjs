// One sync run: fetch -> normalize -> sanity check -> Postgres + products.json (+ alerts table for the messenger).
// Exit codes: 0 ok, 2 warning (rejected products / fallback paths), 1 failed (nothing written).
// Designed to be launched by any scheduler (Task Scheduler via run-sync.cmd, cron, NestJS @Cron, ...).
import fs from 'node:fs';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { login, hasSession, AuthError } from './auth.mjs';
import { fetchAllProducts, fetchProductPages, fetchHomePage } from './source.mjs';
import { StructureError } from './rsc.mjs';
import { checkProduct, checkUnitDrift, UnitError } from './sanity.mjs';
import { openDb, loadPrevious, upsertProducts, syncCategories, recordRun, diffCatalog, recordEvents, applySettings, setStatus, detailsDue, saveDetails, saveRich, syncBrands, assignSlugs, saveHeroSlides } from './db.mjs';
import { parseHeroSlides, heroHash, SKIP_REASON_FA } from './hero.mjs';
import { checkImages, applyImageChecks } from './images.mjs';
import { sectionHashes } from './product-details.mjs';
import { KNOWN_BRAND_LATIN, englishSlug, persianSlug, transliterate } from './slug.mjs';

class CoverageError extends Error {}
class LoginError extends Error {} // login itself failed -> needs a human
class DatabaseError extends Error {}

async function relogin() {
  try {
    await login();
  } catch (e) {
    throw new LoginError(e.message);
  }
}

async function fetchWithSession() {
  if (!hasSession()) await relogin();
  try {
    return await fetchAllProducts();
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    log.warn('Session invalid, re-login once', { reason: e.message });
    await relogin();
    try {
      return await fetchAllProducts();
    } catch (e2) {
      if (e2 instanceof AuthError) throw new LoginError(`لاگین انجام شد ولی سشن باز هم رد شد: ${e2.message}`);
      throw e2;
    }
  }
}

// Human-readable headline per failure kind (Telegram + sync_runs.failure_kind).
function classify(e) {
  if (e instanceof LoginError) return ['auth', '🔐 توکن منقضی شده و لاگین خودکار شکست خورد — لاگین دستی لازم است (npm run login)'];
  if (e instanceof StructureError) return ['structure', '🧩 ساختار صفحه‌ی تأمین‌کننده عوض شده — ربات متوقف شد و چیزی ننوشت'];
  if (e instanceof UnitError) return ['unit', '💱 واحد قیمت لیاتیم عوض شده به نظر می‌رسد (تومان/ریال) — هیچ قیمتی نوشته نشد، بررسی دستی لازم است'];
  if (e instanceof CoverageError) return ['coverage', '📉 کمتر از ۹۰٪ محصولات دریافت شد — چیزی نوشته نشد'];
  if (e instanceof DatabaseError) return ['database', '🗄️ دیتابیس در دسترس نیست (Docker Desktop / Postgres روشن است؟)'];
  return ['error', '❌ اجرای sync شکست خورد'];
}

// Non-secret session facts for the dashboard: whether a session exists and when its token cookie expires.
function sessionInfo() {
  try {
    const state = JSON.parse(fs.readFileSync(config.storageStatePath, 'utf8'));
    const token = state.cookies?.find((c) => c.name === 'lia-token');
    return { present: Boolean(token), expires_at: token?.expires > 0 ? new Date(token.expires * 1000).toISOString() : null };
  } catch {
    return { present: false, expires_at: null };
  }
}

// Settings in effect (config.mjs defaults overlaid with the settings table), shown in the dashboard.
const effectiveConfig = () => ({ excludedCategories: config.excludedCategories, sellableOverrides: config.sellableOverrides,
  priceJumpLimit: config.priceJumpLimit, intervalHours: config.intervalHours });

// Only a masked username leaves the bot (e.g. 0912••••47); the password is reported as set / not set.
const maskUser = (u) => (!u ? null : u.length >= 7 ? `${u.slice(0, 4)}••••${u.slice(-2)}` : '••••');

async function main() {
  const startedAt = new Date();
  const run = { startedAt, status: 'failed', fetched: 0, written: 0, sellable: 0, rejected: 0, failureKind: null, message: null };
  const alertLines = [];
  let db;
  try {
    db = await openDb().catch((e) => {
      const code = e.code ?? e.errors?.[0]?.code ?? e.name; // pg throws an AggregateError with empty message
      throw new DatabaseError(`اتصال به Postgres برقرار نشد (${code})${e.message ? ': ' + e.message : ''}`);
    });
    const fromDb = await applySettings(db, config);
    if (fromDb.length) log.info('Settings from database', { keys: fromDb });
    const { products, total, fallbacks, categories, tree, shape } = await fetchWithSession();
    run.fetched = products.length;

    if (products.length < total * config.minCoverage) {
      throw new CoverageError(`فقط ${products.length} از ${total} محصول دریافت شد (حداقل لازم: ${Math.ceil(total * config.minCoverage)})`);
    }

    const prev = await loadPrevious(db);
    // Whole-catalog ×10 / ÷10 move = the unit changed: stop before writing anything (throws UnitError).
    const drift = checkUnitDrift(products, prev);
    if (drift != null) log.info(`price unit check: median new/old ${drift.toFixed(3)}`);
    const accepted = [];
    const rejected = [];
    for (const p of products) {
      const problems = checkProduct(p, prev.get(p.id));
      if (problems.length) rejected.push({ id: p.id, name: p.name, problems });
      else accepted.push(p);
    }
    for (const r of rejected) log.alert(`Product ${r.id} not updated: ${r.problems.join('; ')}`, { id: r.id, name: r.name });

    const seenIds = new Set(products.map((p) => p.id));
    const events = diffCatalog(prev, accepted, seenIds);
    await upsertProducts(db, accepted);
    await recordEvents(db, events, events.filter((e) => e.kind === 'removed').map((e) => e.product_id));
    if (events.length) {
      const byKind = events.reduce((m, e) => ({ ...m, [e.kind]: (m[e.kind] || 0) + 1 }), {});
      log.info(`catalog changes: ${events.length}`, byKind);
    }
    log.info(`images: ${accepted.filter((p) => p.image_url).length}/${accepted.length} products have a picture`);
    run.written = accepted.length;
    run.rejected = rejected.length;

    const usedCodes = new Set(products.flatMap((p) => p.category));
    const cats = await syncCategories(db, tree, categories, usedCodes);
    const unnamed = [...usedCodes].filter((c) => !categories.has(c));
    log.info(`categories: ${tree ? `Liateam tree of ${tree.length}` : `${categories.size} guessed (no official tree)`}, ${cats.stored} stored, ${cats.changes.length} changed`,
      cats.changes.length || unnamed.length ? { changes: cats.changes, unnamedThisRun: unnamed } : undefined);

    // products.json mirrors the accepted, sellable state in the DB (rejected products keep their last good values;
    // excluded-category products stay in the DB with is_sellable=false).
    const { rows } = await db.query(
      'SELECT id, uuid, name, price, cost_price, stock, category, category_names, is_available, updated_at, last_seen_at FROM product_catalog WHERE is_sellable ORDER BY id',
    );
    run.sellable = rows.length;
    const out = { synced_at: new Date().toISOString(), currency: 'IRT', count: rows.length,
      products: rows.map((r) => ({ ...r, price: Number(r.price), cost_price: Number(r.cost_price) })) };
    fs.writeFileSync(config.outputJson + '.tmp', JSON.stringify(out, null, 2));
    fs.renameSync(config.outputJson + '.tmp', config.outputJson);

    const missing = [...prev.keys()].filter((id) => !seenIds.has(id));
    if (missing.length) log.warn(`${missing.length} previously known products not in source anymore`, { ids: missing });

    // Early warning: Liateam added or removed fields. Everything still reads correctly (otherwise the
    // run would have stopped), but this is usually the first sign of a redesign on their side.
    const { rows: [prevShape] } = await db.query(`SELECT value FROM bot_status WHERE key = 'payload_shape'`);
    if (prevShape?.value?.keys) {
      const before = new Set(prevShape.value.keys);
      const added = shape.filter((k) => !before.has(k));
      const removed = prevShape.value.keys.filter((k) => !shape.includes(k));
      if (added.length || removed.length) {
        alertLines.push('🧬 ساختار داده‌های لیاتیم تغییر کرد (فعلاً همه‌چیز درست خوانده می‌شود؛ احتمالاً سایتشان در حال به‌روزرسانی است):');
        if (added.length) alertLines.push(`• فیلد جدید: ${added.slice(0, 12).join(', ')}`);
        if (removed.length) alertLines.push(`• فیلد حذف‌شده: ${removed.slice(0, 12).join(', ')}`);
      }
    }
    await setStatus(db, 'payload_shape', { keys: shape, at: new Date().toISOString() });

    // Brand + description come from product pages. Every page this run reads (cross-check, audit, and the
    // details step below) is used for them; they are written only when the text changed.
    const details = { read: new Set(), changed: [], unchanged: 0, noDescription: [], notFound: [], rich: {}, brands: null };
    // Called for each product page as soon as it is read (fetchProductPages' onPage), so progress is saved
    // page by page.
    const keepDetails = async (id, entry) => {
      if (!entry || details.read.has(id)) return; // page not loaded: keep old values, retry next time
      details.read.add(id);
      const d = entry.details;
      if (!d.found) { details.notFound.push(id); return; } // structure changed: never wipe stored text
      if (!d.description) details.noDescription.push(id);
      if ((await saveDetails(db, id, d)) === 'changed') details.changed.push(id);
      else details.unchanged++;
      if (d.rich) for (const s of await saveRich(db, id, d.rich, sectionHashes(d.rich))) details.rich[s] = (details.rich[s] ?? 0) + 1;
      // the same list is on every page: mirror it with the first page read, so an interrupted run still has brands
      if (!details.brands && d.brands.length) {
        details.brands = d.brands;
        await syncBrands(db, d.brands, transliterate, KNOWN_BRAND_LATIN);
      }
    };

    // Once a day: verify 3 random products against their own product page (3 extra requests).
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
    const { rows: [lastCheck] } = await db.query(`SELECT value FROM bot_status WHERE key = 'crosscheck'`);
    if (lastCheck?.value?.date !== today) {
      const pool = accepted.filter((p) => p.is_sellable);
      const sample = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
      const page = await fetchProductPages(sample.map((p) => p.id), keepDetails);
      const checked = [], mismatched = [];
      for (const p of sample) {
        const v = page.get(p.id)?.pricing;
        if (!v) continue;
        checked.push(p.id);
        if (v.price !== p.price || v.cost_price !== p.cost_price) mismatched.push({ p, v });
      }
      if (mismatched.length) {
        alertLines.push('🔍 بررسی دوطرفه: قیمت این محصولات در صفحه‌ی خودشان با فهرست لیاتیم فرق دارد (احتمالاً خواندن قیمت جایی اشتباه است):');
        for (const { p, v } of mismatched) alertLines.push(`• ${p.id} ${p.name}: فهرست ${p.price} / صفحه ${v.price}`);
      }
      log.info(`cross-check: ${checked.length}/${sample.length} products verified on their own page, ${mismatched.length} mismatched`);
      await setStatus(db, 'crosscheck', { date: today, checked, mismatched: mismatched.map((m) => m.p.id), at: new Date().toISOString() });
    }

    // One-time audit, AUDIT_PER_RUN products per run until every product was checked once; then it
    // stops by itself (only products Liateam adds later are checked, once each).
    const AUDIT_PER_RUN = 10;
    const { rows: done } = await db.query('SELECT product_id FROM product_audit WHERE ok OR attempts >= 3');
    const doneSet = new Set(done.map((r) => r.product_id));
    const todo = products.filter((p) => !doneSet.has(p.id)).slice(0, AUDIT_PER_RUN);
    if (todo.length) {
      const known = new Set(products.map((p) => p.id));
      const pages = await fetchProductPages(todo.map((p) => p.id), keepDetails);
      const problems = [];
      for (const p of todo) {
        const v = pages.get(p.id)?.pricing;
        if (!v) { await db.query('INSERT INTO product_audit (product_id, ok) VALUES ($1, false) ON CONFLICT (product_id) DO UPDATE SET ok = false, checked_at = now(), attempts = product_audit.attempts + 1', [p.id]); continue; }
        const missing = v.variantCodes.filter((c) => !known.has(c));
        const priceMatches = v.price === p.price && v.cost_price === p.cost_price;
        await db.query(
          `INSERT INTO product_audit (product_id, ok, price_matches, prices, variant_codes, missing_variants) VALUES ($1, true, $2, $3, $4, $5)
           ON CONFLICT (product_id) DO UPDATE SET ok = true, checked_at = now(), price_matches = $2, prices = $3, variant_codes = $4, missing_variants = $5`,
          [p.id, priceMatches, v.prices, v.variantCodes, missing]);
        if (v.prices.length > 1) problems.push(`• ${p.id} ${p.name}: چند مدل با قیمت‌های متفاوت (${v.prices.join('، ')})`);
        if (missing.length) problems.push(`• ${p.id} ${p.name}: مدل‌هایی که در فهرست لیاتیم نیستند: ${missing.join('، ')}`);
        if (!priceMatches) problems.push(`• ${p.id} ${p.name}: قیمت صفحه (${v.price}) با فهرست (${p.price}) فرق دارد`);
      }
      if (problems.length) alertLines.push('🔎 بازبینی محصولات چیزی پیدا کرد که باید بررسی شود:', ...problems);
      const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM product_audit WHERE ok OR attempts >= 3');
      log.info(`audit: ${todo.length} products checked this run, ${n}/${products.length} done, ${problems.length} issue(s)`);
      const { rows: [prevAudit] } = await db.query(`SELECT value FROM bot_status WHERE key = 'audit'`);
      const complete = n >= products.length;
      await setStatus(db, 'audit', {
        done: n, total: products.length, complete,
        completed_at: complete ? (prevAudit?.value?.completed_at ?? new Date().toISOString()) : null,
        reported: complete ? (prevAudit?.value?.reported ?? false) : false,
      });
    }

    // Brand / description: a few product pages per run, never-read products first, then week-old ones.
    if (config.detailsPerRun > 0) {
      const due = (await detailsDue(db, config.detailsPerRun + details.read.size, config.detailsMaxAgeDays))
        .filter((id) => !details.read.has(id))
        .slice(0, config.detailsPerRun);
      if (due.length) await fetchProductPages(due, keepDetails);
    }

    const slugged = await assignSlugs(db, englishSlug, persianSlug);
    if (details.read.size) {
      log.info(`rich sections: ${Object.entries(details.rich).map(([k, v]) => `${k} ${v}`).join(', ') || 'no change'}; ` +
        `${details.brands?.length ?? 0} brands mirrored, ${slugged} new slugs`);
      const { rows: [cov] } = await db.query(
        `SELECT count(*) FILTER (WHERE description IS NOT NULL)::int AS described,
                count(*) FILTER (WHERE brand IS NOT NULL)::int AS branded, count(*)::int AS total
           FROM supplier_products WHERE missing_since IS NULL`);
      log.info(`details: ${details.read.size} product pages read, ${details.changed.length} changed, ${details.unchanged} unchanged; ` +
        `${cov.described}/${cov.total} have a description, ${cov.branded}/${cov.total} a brand`,
        { changed: details.changed.slice(0, 20), noDescription: details.noDescription.slice(0, 20) });
      if (details.noDescription.length) log.warn(`details: no description on ${details.noDescription.length} product page(s) (left empty)`, { ids: details.noDescription });
      // Most pages without the product object = their page layout changed; stored text is kept untouched.
      if (details.notFound.length > Math.max(2, details.read.size / 2)) {
        alertLines.push(`🧩 صفحه‌ی محصولات لیاتیم عوض شده: برند/توضیحات ${details.notFound.length} محصول خوانده نشد (مقادیر قبلی حفظ شد).`);
      } else if (details.notFound.length) {
        log.warn(`details: product object not found on ${details.notFound.length} page(s)`, { ids: details.notFound });
      }
    }

    // Photos: a few addresses checked per run on Liateam's image host; a broken main photo is replaced by the first
    // working gallery photo (or none). Never fails the run.
    try {
      const ic = config.imageChecksPerRun > 0 ? await checkImages(db, { limit: config.imageChecksPerRun }) : { checked: 0, broken: 0 };
      const ap = await applyImageChecks(db);
      log.info(`images: ${ic.checked} checked (${ic.broken} broken); ${ap.replaced} products show a gallery photo instead, ${ap.none} without a working photo`);
    } catch (e) {
      log.warn('images: check failed — photos left as they were', { error: e.message });
    }

    // Hero slides of Liateam's home page: one extra page at most every heroEveryHours. A failure never fails the
    // run and never wipes the stored slides.
    const { rows: [heroPrev] } = await db.query(`SELECT value FROM bot_status WHERE key = 'hero'`);
    const heroAge = (Date.now() - Date.parse(heroPrev?.value?.checked_at ?? '1970-01-01')) / 3_600_000;
    if (config.heroEveryHours > 0 && !(heroAge < config.heroEveryHours * 0.9)) {
      try {
        const parsed = parseHeroSlides(await fetchHomePage());
        if (!parsed.found) alertLines.push('🧩 اسلایدر صفحه‌ی اصلی لیاتیم پیدا نشد (ساختار صفحه عوض شده؟) — اسلایدهای قبلی حفظ شد.');
        else {
          const r = await saveHeroSlides(db, parsed, heroHash);
          log.info(`hero: ${r.slides.length} slides${r.changed ? ' (changed, rewritten)' : ', unchanged'}, ${r.skipped.length} skipped`,
            { skipped: r.skipped.map((x) => `${x.source_code} ${x.title}: ${SKIP_REASON_FA[x.reason] ?? x.reason}`) });
        }
      } catch (e) {
        log.warn('hero: home page could not be read — stored slides kept', { error: e.message });
      }
    }

    if (rejected.length) {
      alertLines.push(`⚠️ ${rejected.length} محصول رد شد و مقدار قبلی‌اش حفظ شد:`);
      for (const r of rejected.slice(0, 15)) alertLines.push(`• ${r.id} ${r.name}: ${r.problems.join('؛ ')}`);
      if (rejected.length > 15) alertLines.push(`… و ${rejected.length - 15} مورد دیگر (logs/alerts.log)`);
    }
    if (fallbacks.length) {
      alertLines.push('🔀 مسیر اصلی بعضی فیلدها پیدا نشد و از مسیر جایگزین خوانده شد (ساختار منبع در حال تغییر است):');
      for (const f of fallbacks.slice(0, 10)) alertLines.push(`• ${f}`);
    }

    run.status = alertLines.length ? 'warning' : 'ok';
    run.message = `${accepted.length} written (${accepted.filter((p) => !p.is_sellable).length} not sellable), ${rejected.length} rejected, total reported ${total}`;
    log.info(`Sync ${run.status}: ${run.message}`);
  } catch (e) {
    const [kind, headline] = classify(e);
    run.failureKind = kind;
    run.message = `${e.name}: ${e.message}`;
    alertLines.push(headline, `جزئیات: ${e.message}`);
    log.alert(`Sync FAILED (${kind}): ${run.message}`);
  } finally {
    run.durationMs = Date.now() - startedAt.getTime();
    if (db) {
      await setStatus(db, 'session', { ...sessionInfo(), ok: run.failureKind !== 'auth', checked_at: new Date().toISOString() }).catch(() => {});
      await setStatus(db, 'config', effectiveConfig()).catch(() => {});
      await setStatus(db, 'credentials', { username_masked: maskUser(config.username), password_set: Boolean(config.password) }).catch(() => {});
      await recordRun(db, run, alertLines).catch((e) => log.warn('Could not record run', { error: e.message }));
      await db.end();
    }
  }

  // Alerts reach people through src/messenger.mjs (Telegram / Bale), which reads sync_runs + sync_alerts.
  process.exitCode = run.status === 'ok' ? 0 : run.status === 'warning' ? 2 : 1;
}

await main();
