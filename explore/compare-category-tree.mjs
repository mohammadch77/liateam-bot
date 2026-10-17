// Compares the stored category tree with Liateam's official one (live), and optionally applies it.
//   node explore/compare-category-tree.mjs           report differences only
//   node explore/compare-category-tree.mjs --apply   also run syncCategories (what the sync does)
import { request } from 'playwright';
import fs from 'node:fs';
import { parseOfficialTree } from '../src/categories.mjs';
import { openDb, syncCategories } from '../src/db.mjs';
const opts = { baseURL: 'https://liateam.ir', extraHTTPHeaders: { RSC: '1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' } };
if (fs.existsSync('.auth/state.json')) opts.storageState = '.auth/state.json';
const ctx = await request.newContext(opts);
const tree = parseOfficialTree(await (await ctx.get('/categories?page=1&_rsc')).text());
await ctx.dispose();
if (!tree) throw new Error('official tree not found in the payload');
const db = await openDb();
const show = async (title) => {
  const { rows } = await db.query('SELECT code, name, parent_code, position, in_source FROM categories');
  const by = new Map(rows.map((r) => [r.code, r]));
  const diff = [];
  for (const c of tree) {
    const o = by.get(c.code);
    if (!o || !o.name) { diff.push(`missing: ${c.code} ${c.name}`); continue; }
    if (o.name.replace(/\s+/g, ' ').trim() !== c.name) diff.push(`name: ${c.code} «${o.name}» ≠ «${c.name}»`);
    if (o.parent_code !== c.parent_code) diff.push(`parent: ${c.code} ${c.name}: ${o.parent_code ?? 'root'} ≠ ${c.parent_code ?? 'root'}`);
    if (o.position !== c.position) diff.push(`order: ${c.code} ${c.name}: ${o.position ?? 'none'} ≠ ${c.position}`);
  }
  const listed = new Set(tree.map((c) => c.code));
  for (const o of rows) if (!listed.has(o.code) && o.name && o.in_source !== false) diff.push(`extra (not in Liateam): ${o.code} ${o.name}`);
  console.log(`\n== ${title}: ${diff.length} difference(s)`);
  for (const d of diff) console.log('  ' + d);
};
await show('stored vs Liateam');
if (process.argv.includes('--apply')) {
  const { changes, stored } = await syncCategories(db, tree, new Map(), new Set());
  console.log(`\napplied: ${changes.length} row(s) changed, ${stored} stored`);
  await show('after apply');
  const again = await syncCategories(db, tree, new Map(), new Set());
  console.log(`second run: ${again.changes.length} change(s) (must be 0)`);
}
await db.end();
