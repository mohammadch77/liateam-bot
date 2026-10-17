// Search end to end: suggestions while typing (debounce, highlight, picture/brand/price), Arabic letters and
// misspellings, keyboard (↑/↓/Enter/Esc, «/»), click and Enter to a product, full results ranked by relevance,
// sort, empty state, no horizontal scroll at 390–1920 px. Read-only: can run against any URL of the app.
import { BASE, check, chromium, finish, SHOTS, shot } from './_harness.mjs';

const b = await chromium.launch();

const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const apiCalls = [];
p.on('request', (r) => {
  if (r.url().includes('/api/search/suggest')) apiCalls.push(decodeURIComponent(r.url().split('q=')[1]));
});
await p.goto(BASE + '/', { waitUntil: 'load' });
const box = p.locator('header [class*=desktop] input[role=combobox]');
const list = p.locator('header [class*=desktop] [role=listbox]');
const options = list.locator('[role=option]');
const opts = async () => (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

// «/» focuses the box
await p.keyboard.press('/');
check('«/» focuses the search box', await box.evaluate((el) => el === document.activeElement));

// gradual typing updates suggestions; debounce keeps requests few
await box.pressSequentially('ری', { delay: 60 });
await p.waitForTimeout(500);
const after2 = await opts();
await box.pressSequentially('مل', { delay: 60 });
const t0 = Date.now();
await p
  .waitForFunction(
    () => document.querySelector('header [role=listbox] b[class*=hit]')?.textContent === 'ریمل',
    null,
    { timeout: 5000 },
  )
  .catch(() => {});
console.log('   suggestions for the full word after', Date.now() - t0, 'ms');
const after4 = await opts();
check('2 letters already suggest', after2.length > 0, `${after2.length} options`);
check(
  'typing more updates the suggestions',
  after4.join() !== after2.join() && /ریمل/.test(after4[1] ?? after4[0]),
  after4.slice(0, 3).join(' | '),
);
check('debounced: few requests while typing', apiCalls.length <= 3, apiCalls.join(', '));
check('combobox expanded + listbox', (await box.getAttribute('aria-expanded')) === 'true');
const hit = await list.locator('b[class*=hit]').first().innerText();
check('matched part highlighted', hit === 'ریمل', hit);
const thumbs = await list.locator('[class*=thumb] img').count();
check(
  'suggestions show image, price and brand',
  thumbs > 0 && /تومان/.test(after4.join()) && /سرژه/.test(after4.join()),
  `${thumbs} thumbs`,
);
if (SHOTS) {
  await p
    .waitForFunction(
      () => [...document.querySelectorAll('[role=listbox] img')].every((i) => i.complete),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  await shot(p, 'suggest-desktop.png');
}

// keyboard: ↓ ↓ ↑, Esc, Enter on option → product page
await p.keyboard.press('ArrowDown');
const a1 = await box.getAttribute('aria-activedescendant');
await p.keyboard.press('ArrowDown');
await p.keyboard.press('ArrowUp');
const a2 = await box.getAttribute('aria-activedescendant');
check('↓/↑ move the active option (aria-activedescendant)', a1 && a1 === a2, `${a1} / ${a2}`);
const sel = await list.locator('[aria-selected=true]').count();
check('active option marked aria-selected', sel === 1);
await p.keyboard.press('Escape');
check(
  'Esc closes the list',
  !(await list.isVisible()) && (await box.getAttribute('aria-expanded')) === 'false',
);
await p.keyboard.press('ArrowDown'); // reopen
await p.keyboard.press('ArrowDown');
const target = (await list.locator('[aria-selected=true]').innerText()).split('\n')[0];
await p.keyboard.press('Enter');
await p.waitForURL(/\/p\//, { timeout: 30000 });
check(
  'Enter on a suggestion opens that product',
  /\/p\//.test(p.url()),
  `${target} → ${decodeURI(p.url()).slice(BASE.length)}`,
);

// click on a suggestion
await p.goto(BASE + '/', { waitUntil: 'load' });
await box.fill('شامپو');
await options.first().waitFor();
await p.waitForTimeout(400);
const firstProduct = list.locator('[role=option][class*=productRow]').first();
const name = (await firstProduct.innerText()).split('\n')[0];
await firstProduct.click();
await p.waitForURL(/\/p\//, { timeout: 30000 });
const h1 = await p.locator('h1').first().innerText();
check('click on a suggestion opens the product page', h1.includes(name.slice(0, 12)), `${name} → ${h1}`);

// Enter with a partial / misspelt word → full results ranked by relevance
for (const [q, expect] of [
  ['رمل', /^ریمل/],
  ['ريمل', /^ریمل/],
  ['شامپ', /^شامپو/],
]) {
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await box.fill(q);
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/search\?q=/, { timeout: 30000 });
  await p.waitForSelector('main [role=status], main [class*=empty]', { timeout: 60000 }).catch(() => {});
  const names = await p.locator('main article h3, main [class*=card] [class*=name]').allInnerTexts();
  const count = await p
    .locator('main [role=status]')
    .first()
    .innerText()
    .catch(() => '');
  check(
    `Enter «${q}» → results page, most relevant first`,
    names.length > 0 && expect.test(names[0].trim()),
    `${count.trim()} · ${names.slice(0, 3).join(' | ')}`,
  );
  if (q === 'رمل') await shot(p, 'results-desktop.png', { fullPage: false });
}
// sort still works on a search
await p.goto(`${BASE}/search?q=${encodeURIComponent('سرم')}&sort=price_asc`, { waitUntil: 'load' });
await p.waitForSelector('main [role=status]', { timeout: 60000 }).catch(() => {});
const prices = (await p.locator('main [class*=amount]').allInnerTexts()).map((t) =>
  Number(t.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\D/g, '')),
);
check(
  'search + sort by price still works',
  prices.length > 2 && prices.every((v, i) => !i || v >= prices[i - 1]),
  prices.slice(0, 5).join(','),
);

// no results state
await p.goto(BASE + '/', { waitUntil: 'load' });
await box.fill('zzqqxx');
await p.waitForTimeout(700);
const empty = await p
  .locator('header [class*=desktop] [class*=empty]')
  .innerText()
  .catch(() => '');
check('clean «no results» state', /پیدا نشد/.test(empty), empty);
await p.close();

// mobile
const m = await b.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await m.goto(BASE + '/', { waitUntil: 'load' });
const mbox = m.locator('header [class*=mobile] input[role=combobox]');
await mbox.fill('بادی');
await m.locator('header [class*=mobile] [role=option]').first().waitFor();
await m.waitForTimeout(500);
check(
  'mobile: no horizontal scroll with suggestions open',
  await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
);
if (SHOTS) {
  await m
    .waitForFunction(
      () => [...document.querySelectorAll('[role=listbox] img')].every((i) => i.complete),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  await shot(m, 'suggest-mobile.png');
}
await m.close();

for (const w of [390, 768, 1024, 1280, 1440, 1920]) {
  const q = await b.newPage({ viewport: { width: w, height: 900 } });
  await q.goto(BASE + '/', { waitUntil: 'load' });
  const inp = q.locator(`header [class*=${w >= 1024 ? 'desktop' : 'mobile'}] input[role=combobox]`);
  await inp.fill('سرم');
  await q.waitForTimeout(800);
  const over = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(`${w}px: suggestions open, no horizontal scroll`, over <= 0, `overflow ${over}`);
  await q.close();
}
await b.close();
finish();
