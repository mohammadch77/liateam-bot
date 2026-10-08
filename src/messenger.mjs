// Telegram + Bale bots for the employer: status, product search, change feed, low stock,
// personal notification settings, manual run (admins) - and push notifications for catalog
// changes and unusual alerts. Answers come ONLY from our database: the bots never contact Liateam.
//   npm run messenger   (systemd: liateam-messenger.service)
import crypto from 'node:crypto';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { openPool, applySettings, setStatus } from './db.mjs';
import { createClient } from './messenger-api.mjs';
import { inQuietHours } from './schedule.mjs';
import * as T from './messenger-text.mjs';

const LOW_STOCK = Number(process.env.LOW_STOCK || 5);
const INTERVAL_PRESETS = [3, 5, 8, 12, 24]; // hours; the bots cannot go below 3 h (dashboard owner can)
const NOTIFY_EVERY_MS = 30_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = await openPool();
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const clients = { telegram: createClient('telegram'), bale: createClient('bale') };
const enabled = (name) => clients[name].configured && config[`${name}Enabled`] === true;

// ---------------------------------------------------------------- helpers
const fa2en = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const normFa = (s) => fa2en(s).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
const hash = (code) => crypto.createHash('sha256').update(code).digest('hex');
const isAdmin = (chat) => chat.role === 'admin';
const nameOf = (from) => [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'بدون نام';

const BTN = {
  status: '📊 وضعیت', changes: '🔔 تغییرات ۲۴ ساعت', search: '🔎 جست‌وجوی محصول',
  low: '📉 رو به اتمام', prefs: '⚙️ اعلان‌های من', run: '🔄 اجرای دستی', help: 'ℹ️ راهنما',
};
const mainKeyboard = (chat) => ({
  keyboard: [
    [{ text: BTN.status }, { text: BTN.changes }],
    [{ text: BTN.search }, { text: BTN.low }],
    isAdmin(chat) ? [{ text: BTN.prefs }, { text: BTN.run }] : [{ text: BTN.prefs }, { text: BTN.help }],
    ...(isAdmin(chat) ? [[{ text: BTN.help }]] : []),
  ],
  resize_keyboard: true,
  is_persistent: true,
});
const inline = (rows) => ({ inline_keyboard: rows });

async function send(client, chatId, text, extra = {}) {
  return client.call('sendMessage', { chat_id: chatId, text: T.clip(text), ...extra });
}
/** Edits the message behind a button; if the platform refuses, sends a new one. */
async function show(client, chatId, messageId, text, markup) {
  if (messageId) {
    try {
      return await client.call('editMessageText', { chat_id: chatId, message_id: messageId, text: T.clip(text), reply_markup: markup });
    } catch (e) {
      if (/not modified/i.test(e.message)) return null;
    }
  }
  return send(client, chatId, text, { reply_markup: markup });
}

async function statusMap() {
  const rows = await q('SELECT key, value FROM bot_status');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
async function audit(chat, action, oldValue, newValue) {
  await q('INSERT INTO settings_audit (actor, action, old_value, new_value) VALUES ($1,$2,$3,$4)',
    [`${chat.platform}:${chat.display_name}`, action, oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue)]);
}

// ---------------------------------------------------------------- linking
const attempts = new Map(); // brute-force brake on invite codes: 5 tries / hour / chat
function tooMany(key) {
  const list = (attempts.get(key) || []).filter((t) => Date.now() - t < 3600_000);
  attempts.set(key, list);
  return list.length >= 5;
}

async function tryLink(client, msg, code) {
  const key = `${client.name}:${msg.chat.id}`;
  if (tooMany(key)) return send(client, msg.chat.id, '⛔️ تلاش‌های ناموفق زیاد بود. یک ساعت دیگر دوباره امتحان کنید.');
  const [invite] = await q(
    `UPDATE messenger_invites SET used_at = now(), used_by = $2
      WHERE id = (SELECT id FROM messenger_invites WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() LIMIT 1)
      RETURNING role`, [hash(code), key]);
  if (!invite) {
    attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
    return send(client, msg.chat.id, '❌ این کد معتبر نیست یا منقضی شده است.\nاز پنل مدیریت یک کد جدید بگیرید و همین‌جا بفرستید.');
  }
  const [chat] = await q(
    `INSERT INTO messenger_chats (platform, chat_id, display_name, role, last_seen_at) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (platform, chat_id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name, last_seen_at = now()
     RETURNING *`, [client.name, msg.chat.id, nameOf(msg.from), invite.role]);
  log.info(`messenger: linked ${client.name} chat as ${invite.role}`);
  await send(client, msg.chat.id,
    `✅ خوش آمدید ${chat.display_name}!\n\nاین ربات به سامانه‌ی همگام‌سازی لیاتیم وصل شد` +
    `${isAdmin(chat) ? ' (دسترسی مدیر)' : ''}.\n\n` +
    'از این به بعد هر تغییر قیمت، موجودی و هر هشدار غیرعادی را همین‌جا خبر می‌دهم.\n' +
    'برای جست‌وجو کافی است اسم یا کد محصول را بنویسید.', { reply_markup: mainKeyboard(chat) });
}

// ---------------------------------------------------------------- screens
async function statusScreen(client, chat, messageId) {
  const [st, [last], [good], [cat], [ch], [pending]] = await Promise.all([
    statusMap(),
    q('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1'),
    q(`SELECT started_at FROM sync_runs WHERE status IN ('ok','warning') ORDER BY started_at DESC LIMIT 1`),
    q(`SELECT count(*) FILTER (WHERE is_sellable AND missing_since IS NULL)::int AS sellable, count(*)::int AS total,
              count(*) FILTER (WHERE is_sellable AND stock <= 0)::int AS out,
              count(*) FILTER (WHERE is_sellable AND stock > 0 AND stock < $1)::int AS low FROM supplier_products`, [LOW_STOCK]),
    q(`SELECT count(*)::int AS n FROM product_events WHERE at > now() - interval '24 hours'`),
    q('SELECT 1 FROM run_requests WHERE picked_at IS NULL LIMIT 1'),
  ]);
  const icon = { ok: '✅', warning: '⚠️', failed: '🚨' };
  const label = { ok: 'موفق', warning: 'با هشدار', failed: 'ناموفق' };
  const worker = st.worker;
  const workerAlive = worker?.heartbeat && Date.now() - new Date(worker.heartbeat).getTime() < 120_000;
  const interval = worker?.interval_hours ?? config.intervalHours;
  const fresh = good && Date.now() - new Date(good.started_at).getTime() < interval * 3600_000 * 1.5;
  const session = st.session;
  const lines = [
    '📊 وضعیت سامانه‌ی لیاتیم', T.LINE,
    last ? `${icon[last.status]} آخرین اجرا: ${label[last.status]} · ${T.ago(last.started_at)}` : '⏳ هنوز اجرایی انجام نشده',
    !workerAlive ? '⏸ زمان‌بندی: متوقف (سرویس worker روشن نیست)'
      : pending ? '⏳ یک اجرای دستی در صف است'
      : `⏭ اجرای بعدی: ${T.ago(worker.next_run_at)} · هر ${T.num(interval)} ساعت`,
    `🔐 ورود به لیاتیم: ${session?.ok === false ? '❌ نیاز به بررسی' : 'خودکار و برقرار'}`,
    `🗂 داده‌ها: ${fresh ? 'به‌روز' : '⚠️ قدیمی'}${good ? ` (${T.ago(good.started_at)})` : ''}`,
    T.LINE,
    `📦 قابل‌فروش: ${T.num(cat.sellable)} از ${T.num(cat.total)} محصول`,
    `🔴 ناموجود: ${T.num(cat.out)}  ·  🟠 رو به اتمام: ${T.num(cat.low)}`,
    `🔔 تغییرات ۲۴ ساعت اخیر: ${T.num(ch.n)}`,
  ];
  const buttons = [[{ text: '🔄 به‌روزرسانی', callback_data: 'st' }, { text: '🔔 تغییرات', callback_data: 'ch:0' }]];
  if (isAdmin(chat)) buttons.push([{ text: `⏱ فاصله‌ی اجرا (هر ${T.num(interval)} ساعت)`, callback_data: 'ivm' }]);
  return show(client, chat.chat_id, messageId, lines.join('\n'), inline(buttons));
}

const visibleKinds = (chat) => (isAdmin(chat) ? Object.keys(T.KIND) : Object.keys(T.KIND).filter((k) => !T.KIND[k].admin));

async function changesScreen(client, chat, messageId, offset = 0) {
  const PAGE = 10;
  const kinds = visibleKinds(chat);
  const [rows, [{ n }]] = await Promise.all([
    q(`SELECT * FROM product_events WHERE at > now() - interval '24 hours' AND kind = ANY($1) ORDER BY id DESC LIMIT $2 OFFSET $3`, [kinds, PAGE, offset]),
    q(`SELECT count(*)::int AS n FROM product_events WHERE at > now() - interval '24 hours' AND kind = ANY($1)`, [kinds]),
  ]);
  if (!n) return show(client, chat.chat_id, messageId, '🔔 در ۲۴ ساعت اخیر تغییری در محصولات ثبت نشده است.\n\nبه محض تغییر قیمت یا موجودی، همین‌جا خبر می‌دهم.', inline([]));
  const text = [`🔔 تغییرات ۲۴ ساعت اخیر · ${T.num(offset + 1)} تا ${T.num(offset + rows.length)} از ${T.num(n)}`, T.LINE,
    ...rows.map((e) => `${T.KIND[e.kind].icon} ${T.KIND[e.kind].label} · ${T.time(e.at)}\n${T.eventLine(e)}`)].join('\n\n');
  const nav = [];
  if (offset > 0) nav.push({ text: '→ قبلی', callback_data: `ch:${Math.max(0, offset - PAGE)}` });
  if (offset + PAGE < n) nav.push({ text: 'بعدی ←', callback_data: `ch:${offset + PAGE}` });
  return show(client, chat.chat_id, messageId, text, inline(nav.length ? [nav] : []));
}

async function lowScreen(client, chat, messageId, offset = 0) {
  const PAGE = 15;
  const where = 'is_sellable AND missing_since IS NULL AND stock < $1';
  const [rows, [{ n }]] = await Promise.all([
    q(`SELECT id, name, stock FROM supplier_products WHERE ${where} ORDER BY stock, name LIMIT $2 OFFSET $3`, [LOW_STOCK, PAGE, offset]),
    q(`SELECT count(*)::int AS n FROM supplier_products WHERE ${where}`, [LOW_STOCK]),
  ]);
  if (!n) return show(client, chat.chat_id, messageId, `✅ همه‌ی محصولات قابل‌فروش حداقل ${T.num(LOW_STOCK)} عدد موجودی دارند.`, inline([]));
  const text = [`📉 ناموجود و رو به اتمام (کمتر از ${T.num(LOW_STOCK)} عدد) · ${T.num(n)} محصول`, T.LINE,
    ...rows.map((p) => (p.stock <= 0 ? `🔴 ${p.name} — ناموجود` : `🟠 ${p.name} — ${T.num(p.stock)} عدد`))].join('\n');
  const nav = [];
  if (offset > 0) nav.push({ text: '→ قبلی', callback_data: `ls:${Math.max(0, offset - PAGE)}` });
  if (offset + PAGE < n) nav.push({ text: 'بعدی ←', callback_data: `ls:${offset + PAGE}` });
  return show(client, chat.chat_id, messageId, text, inline(nav.length ? [nav] : []));
}

async function search(client, chat, text) {
  const term = normFa(text);
  if (term.length < 2) return send(client, chat.chat_id, 'حداقل دو حرف از اسم محصول یا کد آن را بنویسید.');
  const like = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = await q(
    `SELECT id, name, price, stock, is_sellable FROM supplier_products
      WHERE missing_since IS NULL AND (id::text = $2 OR translate(name, 'يك', 'یک') ILIKE $1)
      ORDER BY (id::text = $2) DESC, is_sellable DESC, name LIMIT 8`, [like, term]);
  if (!rows.length) return send(client, chat.chat_id, `🔎 محصولی با «${text.trim()}» پیدا نشد.\nبخشی از اسم (مثلاً «پرفیوم») یا کد محصول را امتحان کنید.`);
  if (rows.length === 1) return productCard(client, chat, rows[0].id);
  const icon = (p) => (!p.is_sellable ? '⚪️' : p.stock <= 0 ? '🔴' : p.stock < LOW_STOCK ? '🟠' : '🟢');
  return send(client, chat.chat_id, `🔎 ${T.num(rows.length)} نتیجه برای «${text.trim()}» — یکی را انتخاب کنید:`, {
    reply_markup: inline(rows.map((p) => [{ text: `${icon(p)} ${p.name.slice(0, 38)} · ${T.toman(p.price)} ت`, callback_data: `p:${p.id}` }])),
  });
}

async function productCard(client, chat, id) {
  const [[p], [lastChange]] = await Promise.all([
    q('SELECT * FROM product_catalog WHERE id = $1', [id]),
    q(`SELECT at FROM product_events WHERE product_id = $1 AND kind = 'price' ORDER BY id DESC LIMIT 1`, [id]),
  ]);
  if (!p) return send(client, chat.chat_id, 'این محصول پیدا نشد.');
  const status = !p.is_sellable ? '⚪️ مخفی (در دسته‌ی کنارگذاشته)' : p.missing_since ? '🗑 دیگر در لیاتیم نیست'
    : p.stock <= 0 ? '🔴 ناموجود' : p.stock < LOW_STOCK ? '🟠 رو به اتمام' : '🟢 موجود';
  const profit = p.price - p.cost_price;
  const lines = [
    `🧴 ${p.name}`,
    `کد ${T.num(p.id)} · ${p.category_names.join('، ') || 'بدون دسته'}`,
    T.LINE,
    `💵 قیمت فروش: ${T.toman(p.price)} تومان`,
    ...(isAdmin(chat) ? [
      `🏷 قیمت تمام‌شده: ${T.toman(p.cost_price)} تومان`,
      `📈 سود: ${T.toman(profit)} تومان (${p.price ? T.pct(profit / p.price) : '—'})`,
    ] : []),
    `📦 موجودی: ${T.num(p.stock)} عدد · ${status}`,
    `🕒 آخرین تغییر قیمت: ${lastChange ? T.ago(lastChange.at) : 'از زمان شروع ثبت، تغییری نداشته'}`,
  ];
  const markup = inline([[{ text: '📈 تاریخچه‌ی قیمت', callback_data: `h:${p.id}` }]]);
  if (p.image_url) {
    try {
      return await client.call('sendPhoto', { chat_id: chat.chat_id, photo: p.image_url, caption: lines.join('\n'), reply_markup: markup });
    } catch { /* image not reachable from the platform's servers: text card below */ }
  }
  return send(client, chat.chat_id, lines.join('\n'), { reply_markup: markup });
}

async function historyScreen(client, chat, id) {
  const [[p], rows] = await Promise.all([
    q('SELECT name FROM supplier_products WHERE id = $1', [id]),
    q('SELECT price, cost_price, stock, recorded_at FROM supplier_price_history WHERE product_id = $1 ORDER BY recorded_at DESC LIMIT 12', [id]),
  ]);
  if (!p) return send(client, chat.chat_id, 'این محصول پیدا نشد.');
  const text = [`📈 تاریخچه‌ی ${p.name}`, T.LINE,
    ...rows.map((r) => `${T.date(r.recorded_at)}\n   ${T.toman(r.price)} تومان · موجودی ${T.num(r.stock)}`)].join('\n');
  return send(client, chat.chat_id, rows.length ? text : 'هنوز تاریخچه‌ای برای این محصول ثبت نشده است.');
}

async function prefsScreen(client, chat, messageId) {
  const text = ['⚙️ اعلان‌های شما', T.LINE,
    chat.notify ? '🔔 اعلان‌ها روشن است. موضوع‌هایی را که می‌خواهید انتخاب کنید:' : '🔕 همه‌ی اعلان‌ها خاموش است.',
    '', 'این تنظیم فقط برای خود شماست و روی بقیه اثری ندارد.'].join('\n');
  const rows = chat.notify
    ? Object.entries(T.GROUPS).map(([g, m]) => [{ text: `${chat.kinds.includes(g) ? '✅' : '⬜️'} ${m.icon} ${m.label}`, callback_data: `n:${g}` }])
    : [];
  rows.push([{ text: chat.notify ? '🔕 خاموش کردن همه' : '🔔 روشن کردن اعلان‌ها', callback_data: 'n:all' }]);
  return show(client, chat.chat_id, messageId, text, inline(rows));
}

async function runConfirm(client, chat) {
  const [[last], [pending]] = await Promise.all([
    q('SELECT started_at FROM sync_runs ORDER BY started_at DESC LIMIT 1'),
    q('SELECT 1 FROM run_requests WHERE picked_at IS NULL LIMIT 1'),
  ]);
  if (pending) return send(client, chat.chat_id, '⏳ یک اجرای دستی از قبل در صف است. نتیجه را خبر می‌دهم.');
  const gapLeft = last ? config.minGapMinutes * 60_000 - (Date.now() - new Date(last.started_at).getTime()) : 0;
  const note = gapLeft > 0
    ? `\n\nآخرین اجرا ${T.ago(last.started_at)} بود. برای این‌که رفتار ربات در سایت لیاتیم طبیعی بماند، بین دو اجرا دست‌کم ${T.num(config.minGapMinutes)} دقیقه فاصله است؛ این اجرا حدود ساعت ${T.time(Date.now() + gapLeft)} انجام می‌شود.`
    : '';
  return send(client, chat.chat_id, `🔄 قیمت‌ها و موجودی همین حالا از لیاتیم به‌روز شود؟${note}`, {
    reply_markup: inline([[{ text: '✅ بله، اجرا کن', callback_data: 'run:yes' }, { text: '✖️ انصراف', callback_data: 'run:no' }]]),
  });
}

async function intervalMenu(client, chat, messageId) {
  return show(client, chat.chat_id, messageId,
    `⏱ ربات هر چند ساعت قیمت‌ها را به‌روز کند؟\n\nفعلاً: هر ${T.num(config.intervalHours)} ساعت\nفاصله‌ی بیشتر یعنی رفتار طبیعی‌تر در سایت لیاتیم. بین ساعت ${T.num(Number(config.quietHours.split('-')[0]))} تا ${T.num(Number(config.quietHours.split('-')[1]))} بامداد اجرای خودکار انجام نمی‌شود.`,
    inline([INTERVAL_PRESETS.map((h) => ({ text: `${h === config.intervalHours ? '● ' : ''}${T.num(h)} ساعت`, callback_data: `iv:${h}` })), [{ text: '→ بازگشت', callback_data: 'st' }]]));
}

const HELP = [
  'ℹ️ راهنمای ربات لیاتیم', T.LINE,
  `${BTN.status} — سلامت ربات، زمان اجرای بعدی و خلاصه‌ی موجودی`,
  `${BTN.changes} — هر تغییری که در قیمت و موجودی دیده شده`,
  `${BTN.search} — یا فقط اسم/کد محصول را بنویسید؛ عکس، قیمت و موجودی را می‌فرستم`,
  `${BTN.low} — محصولات ناموجود و کم‌موجودی`,
  `${BTN.prefs} — انتخاب این‌که درباره‌ی چه چیزهایی خبرتان کنم`,
  '', 'همه‌ی جواب‌ها از آخرین اطلاعات ذخیره‌شده است؛ ربات برای جواب دادن به شما به سایت لیاتیم درخواستی نمی‌فرستد.',
].join('\n');

// ---------------------------------------------------------------- updates
async function getChat(platform, chatId) {
  const [chat] = await q('UPDATE messenger_chats SET last_seen_at = now() WHERE platform = $1 AND chat_id = $2 RETURNING *', [platform, chatId]);
  return chat;
}

async function onMessage(client, msg) {
  if (msg.chat?.type && msg.chat.type !== 'private') return; // private chats only
  const text = String(msg.text || '').trim();
  const chat = await getChat(client.name, msg.chat.id);
  if (!chat) {
    const code = fa2en(text.replace(/^\/start\s*/, '')).replace(/\D/g, '');
    if (code.length === 6) return tryLink(client, msg, code);
    return send(client, msg.chat.id,
      '👋 سلام! این ربات خصوصی سامانه‌ی همگام‌سازی لیاتیم است.\n\nبرای اتصال، کد ۶ رقمی‌ای را که از پنل مدیریت گرفته‌اید همین‌جا بفرستید.');
  }
  if (text.startsWith('/start') || text === '/menu') {
    return send(client, chat.chat_id, `سلام ${chat.display_name} 👋\nاز دکمه‌های پایین استفاده کنید یا اسم محصول را بنویسید.`, { reply_markup: mainKeyboard(chat) });
  }
  switch (text) {
    case BTN.status: case '/status': return statusScreen(client, chat);
    case BTN.changes: case '/changes': return changesScreen(client, chat);
    case BTN.low: case '/low': return lowScreen(client, chat);
    case BTN.prefs: return prefsScreen(client, chat);
    case BTN.help: case '/help': return send(client, chat.chat_id, HELP, { reply_markup: mainKeyboard(chat) });
    case BTN.search: return send(client, chat.chat_id, '🔎 اسم یا کد محصول را بنویسید (مثلاً «پرفیوم» یا «۵۴۷»):');
    case BTN.run: return isAdmin(chat) ? runConfirm(client, chat) : send(client, chat.chat_id, 'این گزینه فقط برای مدیر فعال است.');
    default: return search(client, chat, text);
  }
}

async function onCallback(client, cb) {
  await client.call('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
  const chatId = cb.message?.chat?.id;
  const chat = chatId && (await getChat(client.name, chatId));
  if (!chat) return;
  const mid = cb.message.message_id;
  const [cmd, arg] = String(cb.data || '').split(':');
  if (cmd === 'st') return statusScreen(client, chat, mid);
  if (cmd === 'ch') return changesScreen(client, chat, mid, Number(arg) || 0);
  if (cmd === 'ls') return lowScreen(client, chat, mid, Number(arg) || 0);
  if (cmd === 'p') return productCard(client, chat, Number(arg));
  if (cmd === 'h') return historyScreen(client, chat, Number(arg));
  if (cmd === 'n') {
    const next = arg === 'all'
      ? await q('UPDATE messenger_chats SET notify = NOT notify WHERE id = $1 RETURNING *', [chat.id])
      : await q(`UPDATE messenger_chats SET kinds = CASE WHEN $2 = ANY(kinds) THEN array_remove(kinds, $2) ELSE array_append(kinds, $2) END
                  WHERE id = $1 RETURNING *`, [chat.id, T.GROUPS[arg] ? arg : 'errors']);
    return prefsScreen(client, next[0], mid);
  }
  if (!isAdmin(chat)) return;
  if (cmd === 'run' && arg === 'no') return show(client, chat.chat_id, mid, '✖️ اجرای دستی لغو شد.', inline([]));
  if (cmd === 'run' && arg === 'yes') {
    const [pending] = await q('SELECT 1 FROM run_requests WHERE picked_at IS NULL LIMIT 1');
    if (!pending) {
      await q('INSERT INTO run_requests (requested_by) VALUES ($1)', [`${chat.platform}:${chat.chat_id}`]);
      await audit(chat, 'manual_run');
    }
    const st = await statusMap();
    const alive = st.worker?.heartbeat && Date.now() - new Date(st.worker.heartbeat).getTime() < 120_000;
    return show(client, chat.chat_id, mid, alive
      ? '⏳ در صف اجرا قرار گرفت. معمولاً ۱ تا ۲ دقیقه طول می‌کشد؛ نتیجه را همین‌جا خبر می‌دهم.'
      : '⚠️ در صف قرار گرفت، ولی سرویس زمان‌بندی (worker) روشن نیست؛ تا روشن نشود اجرا انجام نمی‌شود.', inline([]));
  }
  if (cmd === 'ivm') return intervalMenu(client, chat, mid);
  if (cmd === 'iv') {
    const h = Number(arg);
    if (!INTERVAL_PRESETS.includes(h)) return;
    const old = config.intervalHours;
    await q(`INSERT INTO settings (key, value) VALUES ('intervalHours', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(h)]);
    await audit(chat, 'intervalHours', old, h);
    config.intervalHours = h;
    return show(client, chat.chat_id, mid, `✅ از این به بعد ربات هر ${T.num(h)} ساعت یک‌بار قیمت‌ها را به‌روز می‌کند.`, inline([[{ text: '📊 وضعیت', callback_data: 'st' }]]));
  }
}

const lastStatusWrite = {};
async function reportPlatform(name, fields) {
  if (Date.now() - (lastStatusWrite[name] || 0) < 60_000 && fields.ok) return;
  lastStatusWrite[name] = Date.now();
  await setStatus(pool, `messenger_${name}`, { configured: clients[name].configured, enabled: enabled(name), heartbeat: new Date().toISOString(), ...fields }).catch(() => {});
}

async function pollLoop(name) {
  const client = clients[name];
  let offset = 0;
  let me = null;
  let backoff = 5_000;
  for (;;) {
    if (!enabled(name)) {
      me = null;
      await reportPlatform(name, { ok: false, error: null });
      await sleep(15_000);
      continue;
    }
    try {
      me ??= await client.call('getMe');
      const updates = await client.call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 40_000);
      await reportPlatform(name, { ok: true, username: me.username ?? null, error: null });
      backoff = 5_000;
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          if (u.message) await onMessage(client, u.message);
          else if (u.callback_query) await onCallback(client, u.callback_query);
        } catch (e) {
          log.warn(`messenger ${name}: update failed`, { error: e.message });
        }
      }
    } catch (e) {
      log.warn(`messenger ${name}: polling failed`, { error: e.message });
      lastStatusWrite[name] = 0;
      await reportPlatform(name, { ok: false, username: me?.username ?? null, error: e.message });
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 5 * 60_000);
    }
  }
}

// ---------------------------------------------------------------- notifications
async function recipients(group) {
  const platforms = Object.keys(clients).filter(enabled);
  if (!platforms.length) return [];
  return q('SELECT * FROM messenger_chats WHERE notify AND platform = ANY($1) AND $2 = ANY(kinds)', [platforms, group]);
}

async function broadcast(group, build) {
  for (const chat of await recipients(group)) {
    const msg = build(chat);
    if (!msg) continue;
    try {
      await send(clients[chat.platform], chat.chat_id, msg.text, msg.extra);
    } catch (e) {
      log.warn('messenger: notify failed', { platform: chat.platform, error: e.message });
    }
  }
}

async function notifyRuns(cursor) {
  const runs = await q('SELECT * FROM sync_runs WHERE id > $1 ORDER BY id', [cursor.runs_id]);
  for (const run of runs) {
    cursor.runs_id = run.id;
    const alerts = (await q('SELECT message FROM sync_alerts WHERE run_id = $1 ORDER BY id', [run.id])).map((a) => a.message);
    if (run.status === 'failed') {
      await broadcast('errors', () => ({ text: [`🚨 اجرای ربات ناموفق بود · ${T.time(run.started_at)}`, T.LINE,
        `علت: ${T.FAILURE[run.failure_kind] || T.FAILURE.error}`, ...alerts.slice(1, 5).map((a) => `• ${a}`), '',
        'تا رفع مشکل، اطلاعات آخرین اجرای موفق نمایش داده می‌شود و چیزی خراب نشده است.'].join('\n') }));
    } else if (run.status === 'warning') {
      await broadcast('errors', () => ({ text: [`⚠️ هشدار در اجرای ربات · ${T.time(run.started_at)}`, T.LINE, ...alerts.slice(0, 10)].join('\n') }));
    } else if (cursor.last_status === 'failed') {
      await broadcast('errors', () => ({ text: `✅ ربات دوباره سالم است و اطلاعات به‌روز شد (${T.time(run.started_at)}).` }));
    }
    cursor.last_status = run.status;
  }
}

async function notifyEvents(cursor) {
  // Only events of finished runs (a run writes its events before its sync_runs row).
  const events = await q(
    `SELECT * FROM product_events WHERE id > $1 AND at <= (SELECT max(finished_at) FROM sync_runs) ORDER BY id`, [cursor.events_id]);
  if (!events.length) return;
  cursor.events_id = events.at(-1).id;
  const groupOf = (kind) => Object.entries(T.GROUPS).find(([, g]) => g.kinds.includes(kind))?.[0];
  const platforms = Object.keys(clients).filter(enabled);
  const chats = platforms.length ? await q('SELECT * FROM messenger_chats WHERE notify AND platform = ANY($1)', [platforms]) : [];
  for (const chat of chats) {
    const mine = events.filter((e) => chat.kinds.includes(groupOf(e.kind)) && visibleKinds(chat).includes(e.kind));
    if (!mine.length) continue;
    const unusual = mine.filter((e) => e.kind === 'price' && Math.abs((e.new_value - e.old_value) / e.old_value) >= T.UNUSUAL_PRICE).length;
    const text = [`🛰 به‌روزرسانی لیاتیم · ${T.time(mine.at(-1).at)}`,
      `${T.num(mine.length)} تغییر در محصولات${unusual ? ` · ⚠️ ${T.num(unusual)} تغییر قیمت غیرعادی` : ''}`,
      T.eventSections(mine)].join('\n');
    try {
      await send(clients[chat.platform], chat.chat_id, text, { reply_markup: inline([[{ text: '📋 همه‌ی تغییرات', callback_data: 'ch:0' }]]) });
    } catch (e) {
      log.warn('messenger: notify failed', { platform: chat.platform, error: e.message });
    }
  }
}

async function notifyManualResults() {
  const rows = await q(
    `SELECT r.id, r.requested_by, s.status, s.started_at, s.finished_at, s.failure_kind,
            (SELECT count(*)::int FROM product_events e WHERE e.at BETWEEN s.started_at AND s.finished_at + interval '5 seconds') AS changes
       FROM run_requests r
       JOIN LATERAL (SELECT * FROM sync_runs WHERE started_at >= r.picked_at - interval '1 minute' ORDER BY started_at LIMIT 1) s ON true
      WHERE r.picked_at IS NOT NULL AND r.notified_at IS NULL AND r.requested_by LIKE '%:%'`);
  for (const r of rows) {
    await q('UPDATE run_requests SET notified_at = now() WHERE id = $1', [r.id]);
    const [platform, chatId] = r.requested_by.split(':');
    if (!enabled(platform)) continue;
    const text = r.status === 'failed'
      ? `🚨 اجرای دستی ناموفق بود: ${T.FAILURE[r.failure_kind] || T.FAILURE.error}`
      : `✅ اجرای دستی انجام شد${r.status === 'warning' ? ' (با هشدار)' : ''}.\n${r.changes ? `${T.num(r.changes)} تغییر پیدا شد؛ جزئیات در پیام به‌روزرسانی.` : 'تغییری در قیمت و موجودی نبود.'}`;
    await send(clients[platform], chatId, text).catch((e) => log.warn('messenger: manual result failed', { error: e.message }));
  }
}

async function notifyStale(cursor) {
  const [good] = await q(`SELECT started_at FROM sync_runs WHERE status IN ('ok','warning') ORDER BY started_at DESC LIMIT 1`);
  if (!good) return;
  const limit = config.intervalHours * 3600_000 * 2.5 + 6 * 3600_000 * (inQuietHours(config.quietHours) ? 1 : 0);
  const stale = Date.now() - new Date(good.started_at).getTime() > limit;
  if (stale && !cursor.stale_alerted) {
    cursor.stale_alerted = true;
    await broadcast('errors', () => ({ text: `⏰ اطلاعات قیمت‌ها قدیمی شده است\nآخرین به‌روزرسانی موفق: ${T.ago(good.started_at)}.\nاحتمالاً سرویس زمان‌بندی روی سرور متوقف شده است.` }));
  } else if (!stale && cursor.stale_alerted) {
    cursor.stale_alerted = false;
  }
}

const DAILY_HOUR = 9; // Tehran
const tehranDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
const tehranHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));

/** Once a day: a short health report. If it ever does not arrive, something is wrong with the server. */
async function dailyReport(cursor) {
  if (tehranHour() < DAILY_HOUR || cursor.daily_date === tehranDay()) return;
  cursor.daily_date = tehranDay();
  const [[runs], kinds, [cat], st, [good]] = await Promise.all([
    q(`SELECT count(*) FILTER (WHERE status = 'ok')::int AS ok, count(*) FILTER (WHERE status = 'warning')::int AS warning,
              count(*) FILTER (WHERE status = 'failed')::int AS failed FROM sync_runs WHERE started_at > now() - interval '24 hours'`),
    q(`SELECT kind, count(*)::int AS n FROM product_events WHERE at > now() - interval '24 hours' GROUP BY kind`),
    q(`SELECT count(*) FILTER (WHERE is_sellable AND missing_since IS NULL)::int AS sellable, count(*)::int AS total,
              count(*) FILTER (WHERE is_sellable AND stock <= 0)::int AS out,
              count(*) FILTER (WHERE is_sellable AND stock > 0 AND stock < $1)::int AS low FROM supplier_products`, [LOW_STOCK]),
    statusMap(),
    q(`SELECT started_at FROM sync_runs WHERE status IN ('ok','warning') ORDER BY started_at DESC LIMIT 1`),
  ]);
  const changes = kinds.filter((k) => T.KIND[k.kind]).map((k) => `${T.KIND[k.kind].icon} ${T.KIND[k.kind].label}: ${T.num(k.n)}`);
  const healthy = runs.failed === 0 && runs.ok + runs.warning > 0;
  const text = [`☀️ گزارش روزانه‌ی لیاتیم · ${new Date().toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium' })}`, T.LINE,
    healthy ? '✅ همه‌چیز سالم است.' : runs.ok + runs.warning === 0 ? '🚨 در ۲۴ ساعت گذشته هیچ اجرای موفقی نبوده است!' : '⚠️ در ۲۴ ساعت گذشته اجرای ناموفق داشتیم.',
    `🔄 اجراها (۲۴ ساعت): ${T.num(runs.ok)} موفق · ${T.num(runs.warning)} با هشدار · ${T.num(runs.failed)} ناموفق`,
    `🗂 آخرین به‌روزرسانی موفق: ${good ? T.ago(good.started_at) : '—'}`,
    `🔐 ورود به لیاتیم: ${st.session?.ok === false ? '❌ نیاز به بررسی' : 'برقرار'}`,
    T.LINE,
    changes.length ? `🔔 تغییرات ۲۴ ساعت:\n${changes.join('\n')}` : '🔔 در ۲۴ ساعت گذشته تغییری در محصولات نبود.',
    T.LINE,
    `📦 قابل‌فروش: ${T.num(cat.sellable)} از ${T.num(cat.total)} · 🔴 ناموجود: ${T.num(cat.out)} · 🟠 رو به اتمام: ${T.num(cat.low)}`,
  ].join('\n');
  await broadcast('daily', () => ({ text, extra: { reply_markup: inline([[{ text: '📊 وضعیت', callback_data: 'st' }, { text: '🔔 تغییرات', callback_data: 'ch:0' }]]) } }));
}

async function notifierLoop() {
  const st = await statusMap();
  const cursor = st.notify_cursor ?? (await q(
    `SELECT COALESCE((SELECT max(id) FROM product_events), 0) AS events_id, COALESCE((SELECT max(id) FROM sync_runs), 0) AS runs_id`))[0];
  for (;;) {
    try {
      await applySettings(pool, config);
      await notifyRuns(cursor);
      await notifyEvents(cursor);
      await notifyManualResults();
      await notifyStale(cursor);
      await dailyReport(cursor);
      await setStatus(pool, 'notify_cursor', cursor);
    } catch (e) {
      log.warn('messenger: notifier failed', { error: e.message });
    }
    await sleep(NOTIFY_EVERY_MS);
  }
}

await applySettings(pool, config);
// One-time: people linked before the daily report existed get it too (they can switch it off in the bot).
if (!(await statusMap()).migrated_daily) {
  await q(`UPDATE messenger_chats SET kinds = array_append(kinds, 'daily') WHERE NOT 'daily' = ANY(kinds)`);
  await setStatus(pool, 'migrated_daily', true);
}
log.info(`messenger started (telegram: ${clients.telegram.configured ? 'token set' : 'no token'}, bale: ${clients.bale.configured ? 'token set' : 'no token'})`);
pollLoop('telegram');
pollLoop('bale');
await notifierLoop();
