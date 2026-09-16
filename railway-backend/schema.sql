-- ?????????????????????????????????????????????????????????????????????????????
-- schema.sql  -  AllForPets Municipal Portal  -  Full DB schema  (MySQL 8+)
-- Migrated from PostgreSQL to MySQL.
-- Run once on your MySQL server to initialise all tables.
--   mysql -u root -p afp_nagarnigam < schema.sql
-- ?????????????????????????????????????????????????????????????????????????????

-- ?? Database ????????????????????????????????????????????????????????????????
CREATE DATABASE IF NOT EXISTS afp_nagarnigam
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE afp_nagarnigam;

-- ?? Geo tables ??????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS cities (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  state      VARCHAR(100),
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cities_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS nigams (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  city_id          INT NOT NULL,
  name             VARCHAR(150) NOT NULL,
  registration_fee DECIMAL(10,2) NOT NULL DEFAULT 200,
  renewal_fee      DECIMAL(10,2) NOT NULL DEFAULT 150,
  transfer_fee     DECIMAL(10,2) NOT NULL DEFAULT 100,
  is_active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_nigams_city FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS zones (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nigam_id    INT NOT NULL,
  name        VARCHAR(150) NOT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_zones_nigam FOREIGN KEY (nigam_id) REFERENCES nigams(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wards (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nigam_id    INT NULL,
  zone_id     INT NULL,
  ward_number VARCHAR(80) NOT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wards_nigam FOREIGN KEY (nigam_id) REFERENCES nigams(id) ON DELETE SET NULL,
  CONSTRAINT fk_wards_zone  FOREIGN KEY (zone_id)  REFERENCES zones(id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- ?? Users ???????????????????????????????????????????????????????????????????
-- role: citizen | ward_admin | nigam_admin | city_admin | super_admin
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  mobile        VARCHAR(15)  NOT NULL,
  email         VARCHAR(180) NULL,
  password_hash TEXT         NOT NULL,
  address       TEXT         NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'citizen',
  city_id       INT NULL,
  nigam_id      INT NULL,
  zone_id       INT NULL,
  ward_id       INT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_mobile (mobile),
  UNIQUE KEY uq_users_email  (email),
  CONSTRAINT chk_users_role CHECK (role IN ('citizen','ward_admin','nigam_admin','city_admin','super_admin')),
  CONSTRAINT fk_users_city  FOREIGN KEY (city_id)  REFERENCES cities(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_nigam FOREIGN KEY (nigam_id) REFERENCES nigams(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_zone  FOREIGN KEY (zone_id)  REFERENCES zones(id)  ON DELETE SET NULL,
  CONSTRAINT fk_users_ward  FOREIGN KEY (ward_id)  REFERENCES wards(id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- ?? Pets ????????????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS pets (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  pet_id              VARCHAR(30) NULL,
  owner_id            INT NOT NULL,
  name                VARCHAR(80)  NOT NULL,
  species             VARCHAR(30)  NOT NULL,
  breed               VARCHAR(80),
  colour              VARCHAR(60),
  gender              VARCHAR(10),
  date_of_birth       DATE,
  registration_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  licence_status      VARCHAR(30) DEFAULT 'active',
  licence_expiry_date DATE,
  vaccine_next_due    DATE,
  photo_url           TEXT,
  certificate_url     TEXT,
  admin_note          TEXT,
  payment_id          VARCHAR(100),
  txn_ref             VARCHAR(100),
  city_id             INT NULL,
  nigam_id            INT NULL,
  zone_id             INT NULL,
  ward_id             INT NULL,
  breeding_opt_in     TINYINT(1) NOT NULL DEFAULT 0,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pets_pet_id (pet_id),
  CONSTRAINT chk_pets_regstatus CHECK (registration_status IN ('pending','approved','rejected')),
  CONSTRAINT fk_pets_owner FOREIGN KEY (owner_id) REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_pets_city  FOREIGN KEY (city_id)  REFERENCES cities(id) ON DELETE SET NULL,
  CONSTRAINT fk_pets_nigam FOREIGN KEY (nigam_id) REFERENCES nigams(id) ON DELETE SET NULL,
  CONSTRAINT fk_pets_zone  FOREIGN KEY (zone_id)  REFERENCES zones(id)  ON DELETE SET NULL,
  CONSTRAINT fk_pets_ward  FOREIGN KEY (ward_id)  REFERENCES wards(id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- ?? Reports ?????????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS reports (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id       INT NULL,
  reporter_mobile   VARCHAR(15),
  report_type       VARCHAR(30),
  last_seen_address TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'open',
  resolution_note   TEXT,
  resolved_at       TIMESTAMP NULL,
  resolved_by       INT NULL,
  city_id           INT NULL,
  nigam_id          INT NULL,
  zone_id           INT NULL,
  ward_id           INT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT fk_reports_resolver FOREIGN KEY (resolved_by) REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT fk_reports_city     FOREIGN KEY (city_id)     REFERENCES cities(id) ON DELETE SET NULL,
  CONSTRAINT fk_reports_nigam    FOREIGN KEY (nigam_id)    REFERENCES nigams(id) ON DELETE SET NULL,
  CONSTRAINT fk_reports_zone     FOREIGN KEY (zone_id)     REFERENCES zones(id)  ON DELETE SET NULL,
  CONSTRAINT fk_reports_ward     FOREIGN KEY (ward_id)     REFERENCES wards(id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- ?? Report comments ?????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS report_comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  report_id  INT NOT NULL,
  admin_id   INT NOT NULL,
  comment    TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rc_report FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  CONSTRAINT fk_rc_admin  FOREIGN KEY (admin_id)  REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

-- ?? Discussions ?????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS discussions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  category   VARCHAR(50) NOT NULL DEFAULT 'general',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_disc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS discussion_replies (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  discussion_id INT NOT NULL,
  user_id       INT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dr_disc FOREIGN KEY (discussion_id) REFERENCES discussions(id) ON DELETE CASCADE,
  CONSTRAINT fk_dr_user FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB;

-- ?? Doctors ?????????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS doctors (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  qualification  VARCHAR(120),
  specialization VARCHAR(120),
  clinic_name    VARCHAR(150),
  address        TEXT,
  mobile         VARCHAR(15),
  timings        VARCHAR(100),
  is_24hr        TINYINT(1) NOT NULL DEFAULT 0,
  city_id        INT NULL,
  nigam_id       INT NULL,
  zone_id        INT NULL,
  ward_id        INT NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_doctors_city  FOREIGN KEY (city_id)  REFERENCES cities(id) ON DELETE SET NULL,
  CONSTRAINT fk_doctors_nigam FOREIGN KEY (nigam_id) REFERENCES nigams(id) ON DELETE SET NULL,
  CONSTRAINT fk_doctors_zone  FOREIGN KEY (zone_id)  REFERENCES zones(id)  ON DELETE SET NULL,
  CONSTRAINT fk_doctors_ward  FOREIGN KEY (ward_id)  REFERENCES wards(id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- ?? Shops ???????????????????????????????????????????????????????????????????
CREATE TABLE IF NOT EXISTS shops (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  owner_name VARCHAR(120),
  address    TEXT,
  mobile     VARCHAR(15),
  timings    VARCHAR(100),
  speciality VARCHAR(150),
  city_id    INT NULL,
  nigam_id   INT NULL,
  zone_id    INT NULL,
  ward_id    INT NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shops_city  FOREIGN KEY (city_id)  REFERENCES cities(id) ON DELETE SET NULL,
  CONSTRAINT fk_shops_nigam FOREIGN KEY (nigam_id) REFERENCES nigams(id) ON DELETE SET NULL,
  CONSTRAINT fk_shops_zone  FOREIGN KEY (zone_id)  REFERENCES zones(id)  ON DELETE SET NULL,
  CONSTRAINT fk_shops_ward  FOREIGN KEY (ward_id)  REFERENCES wards(id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- ?? Indexes ?????????????????????????????????????????????????????????????????
CREATE INDEX idx_zones_nigam      ON zones(nigam_id);
CREATE INDEX idx_users_role       ON users(role);
CREATE INDEX idx_users_city       ON users(city_id);
CREATE INDEX idx_users_nigam      ON users(nigam_id);
CREATE INDEX idx_users_zone       ON users(zone_id);
CREATE INDEX idx_users_ward       ON users(ward_id);
CREATE INDEX idx_users_mobile     ON users(mobile);
CREATE INDEX idx_pets_owner       ON pets(owner_id);
CREATE INDEX idx_pets_status      ON pets(registration_status);
CREATE INDEX idx_pets_zone        ON pets(zone_id);
CREATE INDEX idx_pets_ward        ON pets(ward_id);
CREATE INDEX idx_pets_breeding    ON pets(breeding_opt_in);
CREATE INDEX idx_doctors_city     ON doctors(city_id);
CREATE INDEX idx_doctors_zone     ON doctors(zone_id);
CREATE INDEX idx_shops_city       ON shops(city_id);
CREATE INDEX idx_shops_zone       ON shops(zone_id);
CREATE INDEX idx_report_comments_report_id  ON report_comments(report_id);
CREATE INDEX idx_discussions_category       ON discussions(category);
CREATE INDEX idx_disc_replies_discussion_id ON discussion_replies(discussion_id);

-- ?? Seed: default super_admin (password: Admin@123) ????????????????????????
-- bcrypt hash of "Admin@123" with cost 10
INSERT IGNORE INTO users (name, mobile, email, password_hash, role, is_active)
VALUES (
  'Super Admin',
  '9999999999',
  'admin@nagarnigam.gov.in',
  '$2a$10$.x6gPwSpMYgPrWh8J21p3O42zXdOInqke3I6ZDlvWpFz.obAt7AP6',
  'super_admin',
  1
);

-- ?? Seed: sample cities ????????????????????????????????????????????????????
INSERT IGNORE INTO cities (name, state) VALUES
  ('Jaipur', 'Rajasthan'),
  ('Delhi',  'Delhi'),
  ('Mumbai', 'Maharashtra');
