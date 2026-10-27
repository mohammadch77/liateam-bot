// The order status machine (src/lib/orders/status.ts) and its twin in the database (order_status_can_move, migration 013):
// the same answer for every pair of statuses. The database half needs the local Docker Postgres (skipped without it).
// Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOT_STATUSES, ORDER_STATUSES, canMove, isFinal, nextStatuses } from '../../src/lib/orders/status.ts';

test('the happy path, one step at a time', () => {
  const path = ['pending_payment', 'queued', 'placing', 'awaiting_payment', 'supplier_paid', 'sent'] as const;
  for (let i = 0; i < path.length - 1; i++)
    assert.ok(canMove(path[i]!, path[i + 1]!), `${path[i]} → ${path[i + 1]}`);
});

test('a forward step may skip one (the bot is faster than the shop polls); a backward step is refused', () => {
  assert.ok(canMove('queued', 'awaiting_payment'));
  assert.ok(canMove('awaiting_payment', 'sent'));
  assert.ok(!canMove('sent', 'supplier_paid'));
  assert.ok(!canMove('pending_payment', 'sent'));
  assert.ok(!canMove('supplier_paid', 'awaiting_payment'));
});

test('needs_review: reached from the queue, left by an operator (placing again, a refund, or canceling)', () => {
  assert.ok(canMove('queued', 'needs_review'));
  assert.ok(canMove('placing', 'needs_review'));
  assert.ok(canMove('needs_review', 'placing'));
  assert.ok(canMove('needs_review', 'refunded'));
  assert.ok(canMove('needs_review', 'canceled'));
  assert.ok(!canMove('pending_payment', 'needs_review'));
  assert.ok(!canMove('awaiting_payment', 'needs_review'));
});

test('Liateam canceling an unpaid order sends it back to the queue; refunded, canceled and sent are final', () => {
  assert.ok(canMove('awaiting_payment', 'queued'));
  for (const s of ['sent', 'refunded', 'canceled'] as const) {
    assert.ok(isFinal(s), s);
    assert.deepEqual(nextStatuses(s), []);
  }
  assert.ok(!isFinal('queued'));
});

test('no status moves to itself, and the bot statuses are all statuses of the shop', () => {
  for (const s of ORDER_STATUSES) assert.ok(!canMove(s, s), s);
  for (const s of BOT_STATUSES) assert.ok(ORDER_STATUSES.includes(s), s);
  assert.ok(!(BOT_STATUSES as readonly string[]).includes('pending_payment')); // the bot never sees an unpaid order
});

// ── the database's table is the same ──
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function dbTable(): Map<string, boolean> | null {
  try {
    const out = execFileSync(
      'docker',
      [
        'compose',
        '-f',
        path.join(root, 'docker-compose.yml'),
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'lia',
        '-d',
        'lia_sync',
        '-At',
        '-c',
        `SELECT a.e || '>' || b.e || '=' || shop_staging.order_status_can_move(a.e, b.e)
           FROM unnest(enum_range(NULL::shop_staging.order_status)) a(e), unnest(enum_range(NULL::shop_staging.order_status)) b(e)`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return new Map(
      out
        .trim()
        .split('\n')
        .map((l) => [l.split('=')[0]!, l.endsWith('=true')]),
    );
  } catch {
    return null;
  }
}

test('the database function agrees with the TypeScript table for every pair', (t) => {
  const db = dbTable();
  if (!db) return t.skip('local Postgres (migration 013 applied) is not available');
  assert.equal(db.size, ORDER_STATUSES.length ** 2);
  const wrong: string[] = [];
  for (const a of ORDER_STATUSES)
    for (const b of ORDER_STATUSES) if (db.get(`${a}>${b}`) !== canMove(a, b)) wrong.push(`${a}>${b}`);
  assert.deepEqual(wrong, []);
  assert.deepEqual(
    [...ORDER_STATUSES].sort(),
    [...new Set([...db.keys()].map((k) => k.split('>')[0]!))].sort(),
  );
});
