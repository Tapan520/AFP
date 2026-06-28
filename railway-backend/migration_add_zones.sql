-- =========================================================================
-- migration_add_zones.sql
-- Run this on an EXISTING afp_nagarnigam database to add Zone support.
-- New installs: use schema.sql instead (zones are already included).
-- =========================================================================

-- 1. Create zones table (City -> Nigam -> Zone -> Ward)
CREATE TABLE IF NOT EXISTS zones (
  id          SERIAL PRIMARY KEY,
  nigam_id    INTEGER NOT NULL REFERENCES nigams(id) ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Add zone_id to wards (keep nigam_id nullable for backward compat)
ALTER TABLE wards ALTER COLUMN nigam_id DROP NOT NULL;
ALTER TABLE wards ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL;

-- 3. Add zone_id to users / pets / doctors / shops
ALTER TABLE users    ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL;
ALTER TABLE pets     ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL;
ALTER TABLE doctors  ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL;
ALTER TABLE shops    ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_zones_nigam   ON zones(nigam_id);
CREATE INDEX IF NOT EXISTS idx_users_zone    ON users(zone_id);
CREATE INDEX IF NOT EXISTS idx_wards_zone    ON wards(zone_id);
CREATE INDEX IF NOT EXISTS idx_pets_zone     ON pets(zone_id);
CREATE INDEX IF NOT EXISTS idx_doctors_zone  ON doctors(zone_id);
CREATE INDEX IF NOT EXISTS idx_shops_zone    ON shops(zone_id);
