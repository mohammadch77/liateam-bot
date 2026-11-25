-- Blog & Magazine CMS module for Avina Shop
-- Categories, rich articles with SEO fields, tags, scheduled publishing, and 3 business-relevant seed articles.

DO $$ BEGIN
  CREATE TYPE blog_post_status AS ENUM ('draft', 'scheduled', 'published');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. Blog categories (editable/creatable/deletable in admin)
CREATE TABLE IF NOT EXISTS blog_categories (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order  SMALLINT NOT NULL DEFAULT 1,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blog_categories_slug_format CHECK (slug ~ '^[a-z0-9\u0600-\u06FF-]+$')
);

INSERT INTO blog_categories (name, slug, description, sort_order, is_active) VALUES
  ('مراقبت پوست', 'skincare', 'روتین روزانه، آبرسانی، درمان جوش و انتخاب ضدآفتاب مناسب انواع پوست', 1, TRUE),
  ('مراقبت مو', 'haircare', 'راهنمای تقویت ریشه مو، انتخاب شامپو تخصصی و درمان خشکی و ریزش مو', 2, TRUE),
  ('آرایش و زیبایی', 'makeup', 'نکات حرفه‌ای میکاپ، انتخاب کرم‌پودر، رژ لب و ماندگاری بیشتر آرایش', 3, TRUE),
  ('راهنمای خرید و اصالت کالا', 'buying-guide', 'روش‌های تشخیص محصولات آرایشی و بهداشتی اصل و بررسی برندهای معتبر', 4, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- 2. Blog articles
CREATE TABLE IF NOT EXISTS blog_posts (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id          BIGINT REFERENCES blog_categories(id) ON DELETE SET NULL,
  title                TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  excerpt              TEXT NOT NULL DEFAULT '',
  content_html         TEXT NOT NULL DEFAULT '',
  cover_image_url      TEXT,
  cover_image_alt      TEXT,
  meta_title           TEXT NOT NULL DEFAULT '',
  meta_description     TEXT NOT NULL DEFAULT '',
  focus_keyword        TEXT NOT NULL DEFAULT '',
  tags                 TEXT[] NOT NULL DEFAULT '{}',
  reading_time_minutes SMALLINT NOT NULL DEFAULT 3 CHECK (reading_time_minutes >= 1 AND reading_time_minutes <= 120),
  author_name          TEXT NOT NULL DEFAULT 'تحریریه آوینا',
  status               blog_post_status NOT NULL DEFAULT 'draft',
  published_at         TIMESTAMPTZ,
  seo_score            SMALLINT NOT NULL DEFAULT 0 CHECK (seo_score >= 0 AND seo_score <= 100),
  view_count           INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  created_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blog_posts_public_idx
  ON blog_posts (status, published_at DESC)
  WHERE status IN ('published', 'scheduled');

CREATE INDEX IF NOT EXISTS blog_posts_category_idx ON blog_posts (category_id);
CREATE INDEX IF NOT EXISTS blog_posts_tags_idx ON blog_posts USING GIN (tags);

-- 3. Seed 3 high-quality Persian articles tailored to Avina Cosmetics & Skincare
INSERT INTO blog_posts (
  category_id, title, slug, excerpt, content_html,
  cover_image_url, cover_image_alt,
  meta_title, meta_description, focus_keyword,
  tags, reading_time_minutes, author_name, status, published_at, seo_score
)
SELECT
  (SELECT id FROM blog_categories WHERE slug = 'skincare' LIMIT 1),
  'روتین کامل مراقبت از پوست چرب و مختلط در ۵ قدم ساده',
  'oily-skin-care-routine',
  'اگر پوست چرب یا مستعد جوش دارید، با رعایت این ۵ قدم اصولی از شوینده ملایم تا سرم کنترل چربی و ضدآفتاب فاقد چربی، پوستی شفاف و متعادل داشته باشید.',
  '<p>داشتن <strong>روتین مراقبت از پوست چرب</strong> به معنای خشک کردن بیش‌ازحد پوست نیست؛ بلکه هدف اصلی، متعادل نگه داشتن ترشح سبوم و حفظ سد دفاعی پوست است. بسیاری از افراد با شست‌وشوی مکرر و استفاده از محصولات الکلی، باعث تحریک بیشتر غدد چربی می‌شوند.</p>
<h2>قدم اول: پاک‌سازی اصولی با ژل شست‌وشوی ملایم</h2>
<p>صبح و شب صورت خود را با یک ژل شست‌وشوی فاقد سولفات و مخصوص پوست چرب بشویید. ترکیباتی مانند سالیسیلیک اسید و نیاسینامید به پاک‌سازی عمقی منافذ بدون ایجاد کشیدگی کمک می‌کنند.</p>
<h2>قدم دوم: استفاده از تونر متعادل‌کننده pH</h2>
<p>پس از شست‌وشو، تونر کمک می‌کند باقی‌مانده آلودگی‌ها پاک شده و منافذ برای جذب بهتر سرم‌ها آماده شوند. در فروشگاه <a href="/shop/packs">پک‌های کاربردی آوینا</a> می‌توانید روتین‌های هماهنگ پوست چرب را یکجا بررسی کنید.</p>
<h2>قدم سوم: سرم آبرسان و کنترل‌کننده چربی</h2>
<p>برخلاف تصور رایج، پوست چرب هم به آبرسانی نیاز دارد. یک سرم سبک حاوی هیالورونیک اسید یا نیاسینامید، آب مورد نیاز پوست را تأمین کرده و برق ناخوشایند ناحیه T صورت را کاهش می‌دهد.</p>
<blockquote><p>نکته طلایی متخصصان پوست: هرگز به دلیل چرب بودن پوست، مرطوب‌کننده فاقد چربی و ضدآفتاب را از روتین روزانه حذف نکنید.</p></blockquote>
<h2>قدم چهارم و پنجم: مرطوب‌کننده سبک و ضدآفتاب فلوئیدی</h2>
<p>در پایان روتین صبح، از یک ژل‌کرم آبرسان فاقد چربی استفاده کنید و ۱۵ دقیقه پیش از خروج از منزل، ضدآفتاب با SPF50 و بافت سبک بزنید تا از ایجاد لک و تیرگی جای جوش پیشگیری شود.</p>
<ul><li>شست‌وشوی صورت حداکثر دو بار در روز</li><li>تعویض منظم روبالشی هر ۵ تا ۷ روز</li><li>پرهیز از دستکاری جوش‌های فعال</li></ul>',
  '/images/blog/skincare-routine.jpg',
  'روتین مراقبت از پوست چرب و مختلط با محصولات آبرسان و شوینده',
  'روتین مراقبت از پوست چرب و مختلط در ۵ قدم اصولی | آوینا',
  'آموزش کامل روتین مراقبت از پوست چرب و مستعد جوش در ۵ قدم کاربردی؛ از انتخاب ژل شست‌وشو و تونر تا سرم نیاسینامید و ضدآفتاب فاقد چربی در مجله آوینا.',
  'روتین مراقبت از پوست چرب',
  ARRAY['مراقبت پوست', 'پوست چرب', 'روتین پوستی', 'ضدجوش'],
  5,
  'دکتر سارا نادری',
  'published',
  now() - interval '2 days',
  92
WHERE NOT EXISTS (SELECT 1 FROM blog_posts WHERE slug = 'oily-skin-care-routine');

INSERT INTO blog_posts (
  category_id, title, slug, excerpt, content_html,
  cover_image_url, cover_image_alt,
  meta_title, meta_description, focus_keyword,
  tags, reading_time_minutes, author_name, status, published_at, seo_score
)
SELECT
  (SELECT id FROM blog_categories WHERE slug = 'buying-guide' LIMIT 1),
  'راهنمای جامع انتخاب بهترین ضدآفتاب بر اساس نوع پوست',
  'best-sunscreen-buying-guide',
  'تفاوت ضدآفتاب فیزیکی و شیمیایی چیست؟ مقدار استاندارد مصرف ضدآفتاب چقدر است و کدام بافت برای پوست خشک، چرب یا حساس بهترین عملکرد را دارد؟',
  '<p><strong>انتخاب بهترین ضدآفتاب</strong> مهم‌ترین سرمایه‌گذاری برای جلوگیری از پیری زودرس، لک‌های پوستی و آسیب‌های ناشی از اشعه‌های UVA و UVB است. حتی در روزهای ابری یا پشت پنجره، اشعه UVA به لایه‌های عمقی پوست نفوذ می‌کند.</p>
<h2>تفاوت SPF و PA روی بسته‌بندی ضدآفتاب</h2>
<p>عدد SPF میزان محافظت در برابر اشعه UVB (عامل آفتاب‌سوختگی) را نشان می‌دهد، در حالی که علامت PA+++ یا عبارت Broad Spectrum بیانگر محافظت در برابر UVA (عامل چروک و لک) است. برای آب‌وهوای ایران، SPF30 تا SPF50 با محافظت طیف گسترده ایده‌آل است.</p>
<h2>کدام بافت ضدآفتاب برای پوست شما مناسب‌تر است؟</h2>
<ul><li><strong>پوست چرب و مختلط:</strong> ضدآفتاب‌های فلوئیدی، ژل‌کرم و فاقد چربی (Oil-Free) با جلوه مات.</li><li><strong>پوست خشک و دهیدراته:</strong> کرم‌های ضدآفتاب حاوی هیالورونیک اسید، سرامید یا ویتامین E.</li><li><strong>پوست حساس:</strong> ضدآفتاب‌های مینرال (فیزیکی) حاوی زینک اکساید و فاقد عطر.</li></ul>
<h2>قانون دو بند انگشت و تمدید به‌موقع</h2>
<p>برای رسیدن به محافظت واقعی درج‌شده روی محصول، به اندازه دو بند انگشت کامل برای صورت و گردن استفاده کنید و در صورت قرار گرفتن در فضای باز، هر ۲ تا ۳ ساعت آن را تمدید نمایید. می‌توانید جدیدترین مدل‌های اصل را در <a href="/shop">فروشگاه آوینا</a> مقایسه کنید.</p>
<blockquote><p>ضدآفتاب اصل هرگز بوی تند شیمیایی یا بافت دوفاز و بریده‌بریده ندارد؛ همیشه به تاریخ انقضا و اصالت تأمین‌کننده توجه کنید.</p></blockquote>',
  '/images/blog/sunscreen-guide.jpg',
  'راهنمای انتخاب بهترین ضدآفتاب مناسب انواع پوست چرب، خشک و حساس',
  'راهنمای انتخاب بهترین ضدآفتاب بر اساس نوع پوست | مجله آوینا',
  'چگونه بهترین ضدآفتاب مناسب پوست چرب، خشک یا حساس را انتخاب کنیم؟ آشنایی با SPF، PA، بافت فلوئیدی و قانون دو بند انگشت در راهنمای تخصصی آوینا.',
  'انتخاب بهترین ضدآفتاب',
  ARRAY['ضدآفتاب', 'راهنمای خرید', 'مراقبت پوست', 'اصالت کالا'],
  4,
  'تحریریه تخصصی آوینا',
  'published',
  now() - interval '1 day',
  90
WHERE NOT EXISTS (SELECT 1 FROM blog_posts WHERE slug = 'best-sunscreen-buying-guide');

INSERT INTO blog_posts (
  category_id, title, slug, excerpt, content_html,
  cover_image_url, cover_image_alt,
  meta_title, meta_description, focus_keyword,
  tags, reading_time_minutes, author_name, status, published_at, seo_score
)
SELECT
  (SELECT id FROM blog_categories WHERE slug = 'haircare' LIMIT 1),
  'اصول تقویت موهای آسیب‌دیده و کاهش ریزش با روتین خانگی',
  'damaged-hair-repair-routine',
  'اگر موهایتان بر اثر رنگ، دکلره یا حرارت سشوار شکننده و کم‌حجم شده، با انتخاب شامپو تخصصی، ماسک ترمیم‌کننده و سرم مو دوباره به آن درخشش برگردانید.',
  '<p>برای <strong>تقویت موهای آسیب‌دیده</strong> و کاهش ریزش، شناخت نیاز واقعی کف سر و ساقه مو اهمیت زیادی دارد. بسیاری از افراد شامپو را صرفاً بر اساس خشکی ساقه انتخاب می‌کنند، در حالی که شامپو باید متناسب با نوع پوست سر انتخاب شود.</p>
<h2>۱. انتخاب شامپو تخصصی متناسب با پوست سر</h2>
<p>اگر کف سرتان چرب اما ساقه موهایتان خشک است، از شامپوی ملایم کنترل‌کننده چربی فقط برای ریشه استفاده کنید و اجازه دهید کف آن به‌آرامی روی ساقه حرکت کند.</p>
<h2>۲. تغذیه عمقی ساقه با ماسک مو و سرم تقویتی</h2>
<p>هفته‌ای یک تا دو بار از ماسک موی حاوی کراتین، آرگان یا پروتئین ابریشم روی ساقه نم‌دار (با فاصله از ریشه) استفاده کنید. پس از حمام نیز چند قطره روغن یا سرم محافظ حرارت، از ایجاد موخوره جلوگیری می‌کند.</p>
<h2>۳. اشتباهات رایج که باعث ریزش و شکنندگی مو می‌شوند</h2>
<ul><li>شانه زدن موهای کاملاً خیس با برس‌های دندانه ریز</li><li>بستن محکم موها با کش‌های غیرنخی</li><li>استفاده مستقیم از اتو مو بدون اسپری محافظ حرارت</li></ul>
<p>با تداوم این روتین ساده طی ۴ تا ۶ هفته، نرمی، حالت‌پذیری و کاهش چشمگیر ریزش را تجربه خواهید کرد. برای مشاهده مجموعه‌های آماده، صفحه <a href="/shop/packs">روتین‌های مراقبت مو</a> را ببینید.</p>',
  '/images/blog/haircare-guide.jpg',
  'تقویت موهای آسیب‌دیده با شامپو تخصصی، ماسک و سرم مو',
  'تقویت موهای آسیب‌دیده و کاهش ریزش با روتین تخصصی | آوینا',
  'راهنمای کامل تقویت موهای آسیب‌دیده و کنترل ریزش مو در خانه؛ انتخاب شامپو مناسب کف سر، روش صحیح استفاده از ماسک مو و اشتباهات رایج مراقبت مو.',
  'تقویت موهای آسیب‌دیده',
  ARRAY['مراقبت مو', 'تقویت مو', 'شامپو تخصصی', 'ضدریزش'],
  4,
  'مهسا کریمی',
  'published',
  now() - interval '6 hours',
  91
WHERE NOT EXISTS (SELECT 1 FROM blog_posts WHERE slug = 'damaged-hair-repair-routine');
