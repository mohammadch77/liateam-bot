// One sync run: fetch -> normalize -> sanity check -> Postgres + products.json (+ alerts table for the messenger).
// Exit codes: 0 ok, 2 warning (rejected products / fallback paths), 1 failed (nothing written).
// Designed to be launched by any scheduler (Task Scheduler via run-sync.cmd, cron, NestJS @Cron, ...).
import fs from 'node:fs';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { login, hasSession, AuthError } from './auth.mjs';
import { fetchAllProducts, fetchProductPages } from './source.mjs';
import { StructureError } from './rsc.mjs';
import { checkProduct } from './sanity.mjs';
import { openDb, loadPrevious, upsertProducts, upsertCategories, recordRun, diffCatalog, recordEvents, applySettings, setStatus } from './db.mjs';

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
    const { products, total, fallbacks, categories, shape } = await fetchWithSession();
    run.fetched = products.length;

    if (products.length < total * config.minCoverage) {
      throw new CoverageError(`فقط ${products.length} از ${total} محصول دریافت شد (حداقل لازم: ${Math.ceil(total * config.minCoverage)})`);
    }

    const prev = await loadPrevious(db);
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
    const catCount = await upsertCategories(db, categories, usedCodes);
    const unnamed = [...usedCodes].filter((c) => !categories.has(c));
    log.info(`categories: ${categories.size} named in source, ${catCount} stored`, unnamed.length ? { unnamedThisRun: unnamed } : undefined);

    // products.json mirrors the accepted, sellable state in the DB (rejected products keep their last good values;
    // excluded-category products stay in the DB with is_sellable=false).
    const { rows } = await db.query(
      'SELECT id, uuid, name, price, cost_price, stock, category, category_names, is_available, updated_at, last_seen_at FROM product_catalog WHERE is_sellable ORDER BY id',
    );
    run.sellable = rows.length;
    const out = { synced_at: new Date().toISOString(), currency: 'IRR', count: rows.length,
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

    // Once a day: verify 3 random products against their own product page (3 extra requests).
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
    const { rows: [lastCheck] } = await db.query(`SELECT value FROM bot_status WHERE key = 'crosscheck'`);
    if (lastCheck?.value?.date !== today) {
      const pool = accepted.filter((p) => p.is_sellable);
      const sample = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
      const page = await fetchProductPages(sample.map((p) => p.id));
      const checked = [], mismatched = [];
      for (const p of sample) {
        const v = page.get(p.id);
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
    const AUDIT_PER_RUN = 5;
    const { rows: done } = await db.query('SELECT product_id FROM product_audit WHERE ok OR attempts >= 3');
    const doneSet = new Set(done.map((r) => r.product_id));
    const todo = products.filter((p) => !doneSet.has(p.id)).slice(0, AUDIT_PER_RUN);
    if (todo.length) {
      const known = new Set(products.map((p) => p.id));
      const pages = await fetchProductPages(todo.map((p) => p.id));
      const problems = [];
      for (const p of todo) {
        const v = pages.get(p.id);
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
