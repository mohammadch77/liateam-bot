// Sends a test message: `npm run notify:test`
import './config.mjs';
import { notify, telegramConfigured } from './notify.mjs';
if (!telegramConfigured()) {
  console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env first.');
  process.exit(1);
}
const ok = await notify(`✅ liateam-sync: پیام تست — اتصال تلگرام برقرار است (${new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })})`);
console.log(ok ? 'Test message sent.' : 'Send failed - see logs/sync.log (proxy needed in Iran?)');
process.exit(ok ? 0 : 1);
