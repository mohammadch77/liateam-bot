import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeBlogSeo,
  buildTocAndAnnotatedHtml,
  estimateReadingMinutes,
  sanitizeBlogHtml,
  slugifyBlog,
} from '../../src/lib/blog/seo.ts';

test('slugifyBlog handles Persian and Latin titles cleanly', () => {
  assert.equal(slugifyBlog('  روتین پوست چرب و مختلط! '), 'روتین-پوست-چرب-و-مختلط');
  assert.equal(slugifyBlog('Best SPF 50+ Sunscreen Guide!'), 'best-spf-50-sunscreen-guide');
});

test('sanitizeBlogHtml strips scripts, event handlers, and javascript: links while keeping rich tags', () => {
  const dirty = `
    <h1>عنوان داخلی</h1>
    <p style="text-align:center;color:red" onclick="alert(1)">متن <strong>تست</strong></p>
    <script>alert('xss')</script>
    <a href="javascript:alert(1)">بد</a>
    <a href="/shop/packs" target="_blank">خوب</a>
    <figure><img src="/api/blog/media/abc.jpg" alt="تصویر" onerror="alert(2)" /><figcaption>کپشن</figcaption></figure>
  `;
  const clean = sanitizeBlogHtml(dirty);
  assert.ok(!clean.includes('<script'));
  assert.ok(!clean.includes('onclick'));
  assert.ok(!clean.includes('onerror'));
  assert.ok(!clean.includes('javascript:'));
  assert.ok(clean.includes('<h2>عنوان داخلی</h2>'));
  assert.ok(clean.includes('style="text-align:center"'));
  assert.ok(clean.includes('href="/shop/packs" target="_blank" rel="noopener noreferrer"'));
  assert.ok(clean.includes('class="av-blog-figure"'));
});

test('buildTocAndAnnotatedHtml extracts h2 and h3 headings with anchor IDs', () => {
  const html = '<h2>بخش اول</h2><p>متن</p><h3>زیربخش</h3>';
  const { html: out, headings } = buildTocAndAnnotatedHtml(html);
  assert.equal(headings.length, 2);
  assert.deepEqual(headings[0], { id: 'sec-1', level: 2, text: 'بخش اول' });
  assert.deepEqual(headings[1], { id: 'sec-2', level: 3, text: 'زیربخش' });
  assert.ok(out.includes('<h2 id="sec-1">بخش اول</h2>'));
  assert.ok(out.includes('<h3 id="sec-2">زیربخش</h3>'));
});

test('analyzeBlogSeo gives high score to well-optimized Persian article and low score to empty draft', () => {
  const poor = analyzeBlogSeo({
    title: 'تست',
    slug: 'test',
    metaTitle: '',
    metaDescription: '',
    focusKeyword: '',
    excerpt: '',
    contentHtml: '<p>کوتاه</p>',
    coverImageUrl: '',
    coverImageAlt: '',
    tags: [],
  });
  assert.ok(poor.score < 20);
  assert.equal(poor.grade, 'poor');

  const filler = Array(110).fill('مراقبت روزانه و اصولی از پوست باعث درخشش و سلامت پایدار می‌شود.').join(' ');
  const great = analyzeBlogSeo({
    title: 'راهنمای کامل روتین پوست چرب و مستعد جوش',
    slug: 'oily-skin-routine',
    metaTitle: 'راهنمای کامل روتین پوست چرب در ۵ قدم اصولی | آوینا',
    metaDescription:
      'در این راهنمای تخصصی درباره روتین پوست چرب، انتخاب ژل شست‌وشو، تونر و ضدآفتاب فاقد چربی برای کنترل برق صورت و پیشگیری از جوش بیشتر بخوانید.',
    focusKeyword: 'روتین پوست چرب',
    excerpt: 'آموزش گام به گام روتین پوست چرب با محصولات استاندارد و فاقد چربی برای داشتن پوستی شفاف.',
    contentHtml: `<p>داشتن روتین پوست چرب کمک می‌کند ترشح چربی متعادل بماند.</p><h2>قدم اول</h2><p>${filler}</p><h2>قدم دوم</h2><p>محصولات را در <a href="/shop">فروشگاه آوینا</a> ببینید.</p>`,
    coverImageUrl: '/images/blog/skincare-routine.jpg',
    coverImageAlt: 'روتین پوست چرب',
    tags: ['پوست چرب', 'روتین پوستی'],
  });
  assert.ok(great.score >= 90, `Expected >= 90, got ${great.score}`);
  assert.equal(great.grade, 'excellent');
  assert.ok(estimateReadingMinutes(great.wordCount > 0 ? filler : '') >= 1);
});
