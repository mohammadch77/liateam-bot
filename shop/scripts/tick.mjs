// The order worker's heartbeat: asks the running shop (127.0.0.1) to move its paid orders one step further.
//   npm run tick            (a systemd timer runs it every 60 s: deploy/avina/avina-shop-tick.{service,timer})
// It only makes ONE local HTTP call (POST /api/internal/tick with the shared secret CRON_SECRET from the environment file);
// the work itself lives in the shop's service layer. No TypeScript, no database, Node 20.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f)); // never overrides variables already set

if (process.argv.includes('--help')) {
  console.log(
    'usage: npm run tick   (needs CRON_SECRET and PORT in the environment; calls http://127.0.0.1:$PORT)',
  );
  process.exit(0);
}
const { CRON_SECRET: secret, PORT: port } = process.env;
if (!secret || !port) {
  console.error('[tick] CRON_SECRET and PORT are required.');
  process.exit(1);
}
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/internal/tick`, {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
    signal: AbortSignal.timeout(100_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    console.error(
      `[tick] the shop answered ${res.status}${res.status === 404 ? " (CRON_SECRET differs from the shop's, or is not set there)" : ''}`,
    );
    process.exit(1);
  }
  console.log(
    `[tick] tried ${body.tried}, advanced ${body.advanced}, skipped ${body.skipped}, failed ${body.failed}, stuck alerts ${body.stuckAlerts}${body.busy ? ' (already running)' : ''}`,
  );
} catch (e) {
  console.error(`[tick] could not reach the shop: ${e instanceof Error ? e.name : 'error'}`);
  process.exit(1);
}
