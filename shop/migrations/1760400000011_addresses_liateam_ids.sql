-- Up Migration
-- An address that can be shipped through Liateam: Liateam's own province / city ids, the plate and the unit (the sync
-- bot's order service creates the delivery address at Liateam from exactly these). Additive: the columns stay empty
-- for addresses saved before; checkout asks for them and refuses an address without them.
ALTER TABLE addresses
  ADD COLUMN province_id INTEGER CONSTRAINT addresses_province_id_positive CHECK (province_id > 0),
  ADD COLUMN city_id     INTEGER CONSTRAINT addresses_city_id_positive CHECK (city_id > 0),
  ADD COLUMN plate       TEXT    CONSTRAINT addresses_plate_length CHECK (char_length(plate) BETWEEN 1 AND 20),
  ADD COLUMN unit        TEXT    CONSTRAINT addresses_unit_length CHECK (char_length(unit) <= 20);

-- Down Migration
ALTER TABLE addresses
  DROP COLUMN unit,
  DROP COLUMN plate,
  DROP COLUMN city_id,
  DROP COLUMN province_id;
