// The latest change events (what the bot changed and whether the bots announced it yet).
//   npm run events:list                 last 50
//   npm run events:list -- 200 price_changed
import { openDb } from '../src/db.mjs';

const [limit = '50', type = ''] = process.argv.slice(2);
const db = await openDb();
try {
  const { rows } = await db.query(
    `SELECT id, occurred_at, event_type, product_code, summary_fa, notified_at FROM change_events
      WHERE ($2 = '' OR event_type = $2) ORDER BY id DESC LIMIT $1`, [Math.min(Number(limit) || 50, 1000), type]);
  const t = (d) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Tehran', dateStyle: 'short', timeStyle: 'short' }) : 'queued');
  for (const r of rows.reverse()) {
    console.log(`${t(r.occurred_at)}  ${r.event_type.padEnd(20)} ${String(r.product_code ?? '').padStart(4)}  ${r.summary_fa}  [notified: ${t(r.notified_at)}]`);
  }
  console.log(`${rows.length} event(s)`);
} finally {
  await db.end();
}
