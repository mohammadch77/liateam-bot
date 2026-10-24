// Lists the characters in the shop's text that the self-hosted font (src/app/fonts/Vazirmatn-Variable.woff2, a subset —
// scripts/subset-font.py) does not have: those are drawn in the fallback font (Tahoma). Reads every text the shop shows
// from the database (products, FAQs, reviews, categories, brands, tags, slider) and the UI strings in src/.
//   npm run font:check
// Exit 1 when a character is missing that the full Vazirmatn has (add it to the subset). Not counted: emojis (the
// system's emoji font draws them, by design), invisible format characters (bidi marks), and characters the full font
// lacks too (listed, nothing to do).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));
const FONT = path.join(root, 'src/app/fonts/Vazirmatn-Variable.woff2');
const FULL = path.join(root, 'node_modules/vazirmatn/fonts/webfonts/Vazirmatn[wght].woff2');

/** The code points of a WOFF2 font's cmap (formats 4 and 12). The cmap table is never transformed in WOFF2. */
function woff2Codepoints(file) {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`${file}: not a WOFF2 font`);
  const numTables = b.readUInt16BE(12);
  const compressedLength = b.readUInt32BE(20);
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const byte = b[p++];
      v = v * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return v;
    }
    throw new Error('bad UIntBase128');
  };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = b[p++];
    const tag = (flags & 0x3f) === 0x3f ? b.toString('latin1', p, (p += 4)) : KNOWN[flags & 0x3f];
    const version = (flags >> 6) & 3;
    const length = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : length });
  }
  const data = zlib.brotliDecompressSync(b.subarray(p, p + compressedLength));
  let offset = 0;
  for (const t of tables) {
    if (t.tag === 'cmap') return cmapCodepoints(data.subarray(offset, offset + t.length));
    offset += t.length;
  }
  throw new Error(`${file}: no cmap`);
}

function cmapCodepoints(c) {
  const out = new Set();
  const n = c.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const sub = c.readUInt32BE(4 + i * 8 + 4);
    const format = c.readUInt16BE(sub);
    if (format === 4) {
      const segs = c.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14;
      const starts = ends + segs * 2 + 2;
      for (let s = 0; s < segs; s++) {
        const end = c.readUInt16BE(ends + s * 2);
        for (let cp = c.readUInt16BE(starts + s * 2); cp <= end && cp !== 0xffff; cp++) out.add(cp);
      }
    } else if (format === 12) {
      const groups = c.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const at = sub + 16 + g * 12;
        for (let cp = c.readUInt32BE(at); cp <= c.readUInt32BE(at + 4); cp++) out.add(cp);
      }
    }
  }
  return out;
}

// every text the shop shows that comes from the database (a missing table or column is skipped, not an error)
const QUERIES = [
  `SELECT concat_ws(' ', name, description, brand, summary, how_to_use, origin_country, measurement_unit) FROM product_catalog`,
  `SELECT concat_ws(' ', question, answer) FROM product_faqs`,
  `SELECT concat_ws(' ', author, body, reply) FROM product_reviews`,
  `SELECT name FROM categories`,
  `SELECT concat_ws(' ', name, latin_name) FROM brands`,
  `SELECT title FROM product_tags`,
  `SELECT alt FROM hero_slides`,
];

function uiStrings(dir) {
  let text = '';
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) text += uiStrings(f);
    // comments are not shown: drop them (they hold arrows and box lines)
    else if (/\.(tsx?|css)$/.test(e.name))
      text += fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  }
  return text;
}

const have = woff2Codepoints(FONT);
const full = woff2Codepoints(FULL);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const sources = { ui: uiStrings(path.join(root, 'src')) };
for (const q of QUERIES) {
  const table = /FROM (\w+)/.exec(q)[1];
  sources[table] = await db
    .query({ text: q, rowMode: 'array' })
    .then((r) => r.rows.map((row) => row[0] ?? '').join('\n'))
    .catch((e) => (console.log(`  (${table} skipped: ${e.message})`), ''));
}
await db.end();

const emoji = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{20E3}]/u;
const missing = new Map(); // char → { n, where: Set }
for (const [where, text] of Object.entries(sources))
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x20 || have.has(cp) || /\p{Cf}/u.test(ch)) continue;
    const m = missing.get(ch) ?? { n: 0, where: new Set() };
    m.n++;
    m.where.add(where);
    missing.set(ch, m);
  }

const rows = [...missing].sort((a, b) => b[1].n - a[1].n);
const isEmoji = ([ch]) => emoji.test(ch);
const fixable = rows.filter((r) => !isEmoji(r) && full.has(r[0].codePointAt(0)));
const nowhere = rows.filter((r) => !isEmoji(r) && !full.has(r[0].codePointAt(0)));
const hex = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
const line = ([ch, m]) => `  ${hex(ch)}  «${ch}»  ×${m.n}  in ${[...m.where].join(', ')}`;
console.log(`[font:check] the subset has ${have.size} of the full font's ${full.size} characters`);
if (fixable.length) console.log(['missing from the subset (in the full font):', ...fixable.map(line)].join('\n'));
if (nowhere.length) console.log(['not in the full font either (fallback font, nothing to do):', ...nowhere.map(line)].join('\n'));
const emojis = rows.filter(isEmoji).map(([ch]) => ch);
if (emojis.length) console.log(`emojis (system emoji font, as intended): ${emojis.join(' ')}`);
if (fixable.length) console.log('→ add them to UNICODES in scripts/subset-font.py and run it again');
else console.log('ok: every character the shop shows that Vazirmatn has is in the subset');
process.exit(fixable.length ? 1 : 0);
