// One sync run: fetch -> normalize -> sanity check -> Postgres + products.json -> Telegram alert if needed.
// Exit codes: 0 ok, 2 warning (rejected products / fallback paths), 1 failed (nothing written).
// Designed to be launched by any scheduler (Task Scheduler via run-sync.cmd, cron, NestJS @Cron, ...).
import fs from 'node:fs';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { login, hasSession, AuthError } from './auth.mjs';
import { fetchAllProducts } from './source.mjs';
import { StructureError } from './rsc.mjs';
import { checkProduct } from './sanity.mjs';
import { notify } from './notify.mjs';
import { openDb, loadPrevious, upsertProducts, recordRun } from './db.mjs';

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
    const { products, total, fallbacks } = await fetchWithSession();
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

    await upsertProducts(db, accepted);
    run.written = accepted.length;
    run.rejected = rejected.length;

    // products.json mirrors the accepted, sellable state in the DB (rejected products keep their last good values;
    // excluded-category products stay in the DB with is_sellable=false).
    const { rows } = await db.query(
      'SELECT id, uuid, name, price, cost_price, stock, category, is_available, updated_at, last_seen_at FROM supplier_products WHERE is_sellable ORDER BY id',
    );
    run.sellable = rows.length;
    const out = { synced_at: new Date().toISOString(), currency: 'IRR', count: rows.length,
      products: rows.map((r) => ({ ...r, price: Number(r.price), cost_price: Number(r.cost_price) })) };
    fs.writeFileSync(config.outputJson + '.tmp', JSON.stringify(out, null, 2));
    fs.renameSync(config.outputJson + '.tmp', config.outputJson);

    const seen = new Set(products.map((p) => p.id));
    const missing = [...prev.keys()].filter((id) => !seen.has(id));
    if (missing.length) log.warn(`${missing.length} previously known products not in source anymore`, { ids: missing });

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
      await recordRun(db, run).catch((e) => log.warn('Could not record run', { error: e.message }));
      await db.end();
    }
  }

  if (alertLines.length) {
    const label = run.status === 'failed' ? 'شکست' : 'هشدار';
    const header = `🛰 liateam-sync — ${label}\n${startedAt.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })} · ${(run.durationMs / 1000).toFixed(0)}s · دریافت: ${run.fetched} · نوشته: ${run.written} · رد: ${run.rejected}`;
    await notify(`${header}\n\n${alertLines.join('\n')}`);
  }
  process.exitCode = run.status === 'ok' ? 0 : run.status === 'warning' ? 2 : 1;
}

await main();
