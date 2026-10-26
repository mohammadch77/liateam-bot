-- Up Migration
-- «پک‌های کاربردی»: the home section's title and subtitle are edited in /admin/packs (a collection's title and
-- this new subtitle); several collections may run at once and each is a section of the home page. Additive: the four
-- seeded packs (oily, dry, combination, sensitive) are untouched; only the seeded collection's wording changes, and
-- only while it still has the seed's original title.
ALTER TABLE pack_collections
  ADD COLUMN subtitle TEXT NOT NULL DEFAULT '' CONSTRAINT pack_collection_subtitle_length CHECK (char_length(subtitle) <= 200);

UPDATE pack_collections
   SET title = 'پک‌های کاربردی',
       subtitle = 'نوع پوست یا نیازتان را انتخاب کنید؛ هر پک چند محصول مکمل است که با هم مصرف می‌شوند.'
 WHERE slug = 'skin-routine' AND title = 'روتین پوستی';

-- Down Migration
ALTER TABLE pack_collections DROP COLUMN subtitle;
