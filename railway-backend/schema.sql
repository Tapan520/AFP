-- ???????????????????????????????????????????????????????????????????????????
-- schema.sql  -  AllForPets Municipal Portal  -  Full DB schema
-- Run once on Railway PostgreSQL to initialise all tables.
-- ???????????????????????????????????????????????????????????????????????????

-- ??? Extensions ?????????????????????????????????????????????????????????????
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ??? Geo tables ?????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS cities (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  state      VARCHAR(100),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nigams (
  id               SERIAL PRIMARY KEY,
  city_id          INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name             VARCHAR(150) NOT NULL,
  registration_fee NUMERIC(10,2) NOT NULL DEFAULT 200,
  renewal_fee      NUMERIC(10,2) NOT NULL DEFAULT 150,
  transfer_fee     NUMERIC(10,2) NOT NULL DEFAULT 100,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zones (
  id          SERIAL PRIMARY KEY,
  nigam_id    INTEGER NOT NULL REFERENCES nigams(id) ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wards (
  id          SERIAL PRIMARY KEY,
  nigam_id    INTEGER REFERENCES nigams(id) ON DELETE SET NULL,
  zone_id     INTEGER REFERENCES zones(id)  ON DELETE SET NULL,
  ward_number VARCHAR(80) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ??? Users ???????????????????????????????????????????????????????????????????
-- role: citizen | ward_admin | nigam_admin | city_admin | super_admin
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  mobile        VARCHAR(15)  NOT NULL UNIQUE,
  email         VARCHAR(180) UNIQUE,
  password_hash TEXT         NOT NULL,
  address       TEXT,
  role          VARCHAR(20)  NOT NULL DEFAULT 'citizen'
                  CHECK (role IN ('citizen','ward_admin','nigam_admin','city_admin','super_admin')),
  city_id       INTEGER REFERENCES cities(id)  ON DELETE SET NULL,
  nigam_id      INTEGER REFERENCES nigams(id)  ON DELETE SET NULL,
  zone_id       INTEGER REFERENCES zones(id)   ON DELETE SET NULL,
  ward_id       INTEGER REFERENCES wards(id)   ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ??? Pets ????????????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS pets (
  id                  SERIAL PRIMARY KEY,
  pet_id              VARCHAR(30) UNIQUE,        -- e.g. AFP-JA-0001
  owner_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                VARCHAR(80)  NOT NULL,
  species             VARCHAR(30)  NOT NULL,      -- dog|cat|rabbit|bird|other
  breed               VARCHAR(80),
  colour              VARCHAR(60),
  gender              VARCHAR(10),
  date_of_birth       DATE,
  registration_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (registration_status IN ('pending','approved','rejected')),
  licence_status      VARCHAR(30) DEFAULT 'active',
  licence_expiry_date DATE,
  vaccine_next_due    DATE,
  photo_url           TEXT,
  certificate_url     TEXT,
  admin_note          TEXT,
  payment_id          VARCHAR(100),
  txn_ref             VARCHAR(100),
  city_id             INTEGER REFERENCES cities(id) ON DELETE SET NULL,
  nigam_id            INTEGER REFERENCES nigams(id) ON DELETE SET NULL,
  zone_id             INTEGER REFERENCES zones(id)  ON DELETE SET NULL,
  ward_id             INTEGER REFERENCES wards(id)  ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ??? Reports ?????????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS reports (
  id                SERIAL PRIMARY KEY,
  reporter_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_mobile   VARCHAR(15),
  report_type       VARCHAR(30),
  last_seen_address TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'open',
  city_id           INTEGER REFERENCES cities(id)  ON DELETE SET NULL,
  nigam_id          INTEGER REFERENCES nigams(id)  ON DELETE SET NULL,
  zone_id           INTEGER REFERENCES zones(id)   ON DELETE SET NULL,
  ward_id           INTEGER REFERENCES wards(id)   ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration: add geo columns to reports if the table already exists
ALTER TABLE reports ADD COLUMN IF NOT EXISTS city_id  INTEGER REFERENCES cities(id)  ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS nigam_id INTEGER REFERENCES nigams(id)  ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS zone_id  INTEGER REFERENCES zones(id)   ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ward_id  INTEGER REFERENCES wards(id)   ON DELETE SET NULL;

-- ??? Doctors ?????????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS doctors (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  qualification  VARCHAR(120),
  specialization VARCHAR(120),
  clinic_name    VARCHAR(150),
  address        TEXT,
  mobile         VARCHAR(15),
  timings        VARCHAR(100),
  is_24hr        BOOLEAN NOT NULL DEFAULT FALSE,
  city_id        INTEGER REFERENCES cities(id)  ON DELETE SET NULL,
  nigam_id       INTEGER REFERENCES nigams(id)  ON DELETE SET NULL,
  zone_id        INTEGER REFERENCES zones(id)   ON DELETE SET NULL,
  ward_id        INTEGER REFERENCES wards(id)   ON DELETE SET NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ??? Shops ???????????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS shops (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  owner_name VARCHAR(120),
  address    TEXT,
  mobile     VARCHAR(15),
  timings    VARCHAR(100),
  speciality VARCHAR(150),
  city_id    INTEGER REFERENCES cities(id)  ON DELETE SET NULL,
  nigam_id   INTEGER REFERENCES nigams(id)  ON DELETE SET NULL,
  zone_id    INTEGER REFERENCES zones(id)   ON DELETE SET NULL,
  ward_id    INTEGER REFERENCES wards(id)   ON DELETE SET NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ??? Indexes ?????????????????????????????????????????????????????????????????
CREATE INDEX IF NOT EXISTS idx_zones_nigam      ON zones(nigam_id);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_city       ON users(city_id);
CREATE INDEX IF NOT EXISTS idx_users_nigam      ON users(nigam_id);
CREATE INDEX IF NOT EXISTS idx_users_zone       ON users(zone_id);
CREATE INDEX IF NOT EXISTS idx_users_ward       ON users(ward_id);
CREATE INDEX IF NOT EXISTS idx_users_mobile     ON users(mobile);
CREATE INDEX IF NOT EXISTS idx_pets_owner       ON pets(owner_id);
CREATE INDEX IF NOT EXISTS idx_pets_status      ON pets(registration_status);
CREATE INDEX IF NOT EXISTS idx_pets_zone        ON pets(zone_id);
CREATE INDEX IF NOT EXISTS idx_pets_ward        ON pets(ward_id);
CREATE INDEX IF NOT EXISTS idx_doctors_city     ON doctors(city_id);
CREATE INDEX IF NOT EXISTS idx_doctors_zone     ON doctors(zone_id);
CREATE INDEX IF NOT EXISTS idx_shops_city       ON shops(city_id);
CREATE INDEX IF NOT EXISTS idx_shops_zone       ON shops(zone_id);

-- ??? Seed: default super_admin (password: Admin@123) ?????????????????????????
-- bcrypt hash of "Admin@123" with cost 10
INSERT INTO users (name, mobile, email, password_hash, role, is_active)
VALUES (
  'Super Admin',
  '9999999999',
  'admin@nagarnigam.gov.in',
  '$2a$10$.x6gPwSpMYgPrWh8J21p3O42zXdOInqke3I6ZDlvWpFz.obAt7AP6',
  'super_admin',
  TRUE
)
ON CONFLICT (mobile) DO NOTHING;

-- ??? Fee columns migration (safe to re-run on existing databases) ???????????
ALTER TABLE nigams ADD COLUMN IF NOT EXISTS registration_fee NUMERIC(10,2) NOT NULL DEFAULT 200;
ALTER TABLE nigams ADD COLUMN IF NOT EXISTS renewal_fee      NUMERIC(10,2) NOT NULL DEFAULT 150;
ALTER TABLE nigams ADD COLUMN IF NOT EXISTS transfer_fee     NUMERIC(10,2) NOT NULL DEFAULT 100;

-- ??? Seed: sample cities ?????????????????????????????????????????????????????
INSERT INTO cities (name, state) VALUES
  ('Jaipur', 'Rajasthan'),
  ('Delhi',  'Delhi'),
  ('Mumbai', 'Maharashtra')
ON CONFLICT DO NOTHING;

-- ??? Breeding Match column (safe to re-run on existing databases) ??????????
ALTER TABLE pets ADD COLUMN IF NOT EXISTS breeding_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_pets_breeding ON pets(breeding_opt_in) WHERE breeding_opt_in = TRUE;
