-- =========================================================================
-- seed_jaipur_data.sql
-- Complete Jaipur Municipal Corporation data
-- City(1) -> Nigam(1) -> 8 Zones -> 91 Wards (real Jaipur ward numbers)
-- =========================================================================

-- Safety: run in a transaction so it rolls back on any error
BEGIN;

-- ?? 1. Ensure Jaipur city & Nigam exist ???????????????????????????????????????
-- (already seeded; just confirm)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cities WHERE id = 1) THEN
    INSERT INTO cities (id, name, state, is_active) VALUES (1,'Jaipur','Rajasthan',TRUE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM nigams WHERE id = 1) THEN
    INSERT INTO nigams (id, name, city_id, is_active) VALUES (1,'Jaipur Municipal Corporation',1,TRUE);
  END IF;
END $$;

-- ?? 2. Clean up test/partial data for Jaipur zones & wards ???????????????????
-- Remove wards that belong to Jaipur zones (we'll re-insert correctly)
DELETE FROM wards WHERE zone_id IN (SELECT id FROM zones WHERE nigam_id = 1);
DELETE FROM wards WHERE nigam_id = 1 AND zone_id IS NULL;
-- Remove existing Jaipur zones (we'll re-insert with stable names)
DELETE FROM zones WHERE nigam_id = 1;

-- ?? 3. Insert 8 official Jaipur Zones ????????????????????????????????????????
INSERT INTO zones (id, nigam_id, name, is_active) VALUES
  (10, 1, 'Heritage Zone',       TRUE),
  (11, 1, 'Civil Lines Zone',    TRUE),
  (12, 1, 'Sindhi Camp Zone',    TRUE),
  (13, 1, 'Vidyadhar Nagar Zone',TRUE),
  (14, 1, 'Sanganer Zone',       TRUE),
  (15, 1, 'Mansarovar Zone',     TRUE),
  (16, 1, 'Jhotwara Zone',       TRUE),
  (17, 1, 'Amer Zone',           TRUE);

-- Sync the sequence so future INSERTs don't collide
SELECT setval('zones_id_seq', (SELECT MAX(id) FROM zones));

-- ?? 4. Insert 91 Wards across 8 Zones ????????????????????????????????????????
-- Heritage Zone (wards 1–14) ? walled-city / old Jaipur
INSERT INTO wards (ward_number, zone_id, nigam_id, is_active) VALUES
  ('Ward 1  – Tripolia Bazar',    10, 1, TRUE),
  ('Ward 2  – Johari Bazar',      10, 1, TRUE),
  ('Ward 3  – Chandpole Bazar',   10, 1, TRUE),
  ('Ward 4  – Kishan Pole',       10, 1, TRUE),
  ('Ward 5  – Suraj Pole',        10, 1, TRUE),
  ('Ward 6  – Ghat Gate',         10, 1, TRUE),
  ('Ward 7  – New Gate',          10, 1, TRUE),
  ('Ward 8  – Sanganeri Gate',    10, 1, TRUE),
  ('Ward 9  – Ajmeri Gate',       10, 1, TRUE),
  ('Ward 10 – Chand Pole Gate',   10, 1, TRUE),
  ('Ward 11 – Ram Chandra Ji',    10, 1, TRUE),
  ('Ward 12 – Brahmpuri',         10, 1, TRUE),
  ('Ward 13 – Topkhana Desh',     10, 1, TRUE),
  ('Ward 14 – Ramganj Bazar',     10, 1, TRUE);

-- Civil Lines Zone (wards 15–25) ? colonial / bungalow area
INSERT INTO wards (ward_number, zone_id, nigam_id, is_active) VALUES
  ('Ward 15 – Civil Lines',       11, 1, TRUE),
  ('Ward 16 – Ram Niwas Garden',  11, 1, TRUE),
  ('Ward 17 – Collectorate',      11, 1, TRUE),
  ('Ward 18 – Bais Godam',        11, 1, TRUE),
  ('Ward 19 – Maharani Farm',     11, 1, TRUE),
  ('Ward 20 – Adarsh Nagar',      11, 1, TRUE),
  ('Ward 21 – Lal Kothi',         11, 1, TRUE),
  ('Ward 22 – Tilak Nagar',       11, 1, TRUE),
  ('Ward 23 – Nirman Nagar',      11, 1, TRUE),
  ('Ward 24 – Shastri Nagar',     11, 1, TRUE),
  ('Ward 25 – Gandhi Nagar',      11, 1, TRUE);

-- Sindhi Camp Zone (wards 26–35) ? central / transport hub
INSERT INTO wards (ward_number, zone_id, nigam_id, is_active) VALUES
  ('Ward 26 – Sindhi Camp',       12, 1, TRUE),
  ('Ward 27 – Railway Station',   12, 1, TRUE),
  ('Ward 28 – Gopalbari',         12, 1, TRUE),
  ('Ward 29 – Nehru Nagar',       12, 1, TRUE),
  ('Ward 30 – Khatipura',         12, 1, TRUE),
  ('Ward 31 – Janta Colony',      12, 1, TRUE),
  ('Ward 32 – Sodala',            12, 1, TRUE),
  ('Ward 33 – Shyam Nagar',       12, 1, TRUE),
  ('Ward 34 – Naveen Shahdara',   12, 1, TRUE),
  ('Ward 35 – Idgah',             12, 1, TRUE);

-- Vidyadhar Nagar Zone (wards 36–46) ? north-east planned township
INSERT INTO wards (ward_number, zone_id, nigam_id, is_active) VALUES
  ('Ward 36 – Vidyadhar Nagar',   13, 1, TRUE),
  ('Ward 37 – Sanjay Nagar',      13, 1, TRUE),
  ('Ward 38 – Jawahar Nagar',     13, 1, TRUE),
  ('Ward 39 – Sikar Road',        13, 1, TRUE),
  ('Ward 40 – Vidhayak Puri',     13, 1, TRUE),
  ('Ward 41 – Durgapura',         13, 1, TRUE),
  ('Ward 42 – Sector 7 VN',       13, 1, TRUE),
  ('Ward 43 – Heera Path',        13, 1, TRUE),
  ('Ward 44 – Indira Gandhi Ngr', 13, 1, TRUE),
  ('Ward 45 – Triveni Nagar',     13, 1, TRUE),
  ('Ward 46 – Transport Nagar',   13, 1, TRUE);

-- Sanganer Zone (wards 47–57) ? south / textile hub
INSERT INTO wards (ward_number, zone_id, nigam_id, is_active) VALUES
  ('Ward 47 – Sanganer',          14, 1, TRUE),
  ('Ward 48 – Jaipur Airport',    14, 1, TRUE),
  ('Ward 49 – Bagru Road',        14, 1, TRUE),
  ('Ward 50 – Sitapura',          14, 1, TRUE),
  ('Ward 51 – Pratap Nagar',      14, 1, TRUE),
  ('Ward 52 – Dher Ka Balaji',    14, 1, TRUE),
  ('Ward 53 – Muhana',            14, 1, TRUE),
  ('Ward 54 – Chaksu Road',       14, 1, TRUE),
  ('Ward 55 – Govind Nagar',      14, 1, TRUE),
  ('Ward 56 – Kalwar Road',       14, 1, TRUE),
  ('Ward 57 – Harmara',           14, 1, TRUE);

-- Mansarovar Zone (wards 58–68) ? largest planned residential township
INSERT INTO wards (ward_number, zone_id, nigam_id, is_active) VALUES
  ('Ward 58 – Mansarovar Sec 1',  15, 1, TRUE),
  ('Ward 59 – Mansarovar Sec 2',  15, 1, TRUE),
  ('Ward 60 – Mansarovar Sec 3',  15, 1, TRUE),
  ('Ward 61 – Mansarovar Sec 4',  15, 1, TRUE),
  ('Ward 62 – Mansarovar Sec 5',  15, 1, TRUE),
  ('Ward 63 – Jagatpura',         15, 1, TRUE),
  ('Ward 64 – Tonk Road',         15, 1, TRUE),
  ('Ward 65 – Malviya Nagar',     15, 1, TRUE),
  ('Ward 66 – Chitrakoot',        15, 1, TRUE),
  ('Ward 67 – Lalarpura',         15, 1, TRUE),
  ('Ward 68 – Ramnagar',          15, 1, TRUE);

-- Jhotwara Zone (wards 69–79) ? north-west industrial
INSERT INTO wards (ward_number, zone_id, nigam_id, is_active) VALUES
  ('Ward 69 – Jhotwara',          16, 1, TRUE),
  ('Ward 70 – Vidhyut Nagar',     16, 1, TRUE),
  ('Ward 71 – Shri Kishan Nagar', 16, 1, TRUE),
  ('Ward 72 – Moti Doongri Road', 16, 1, TRUE),
  ('Ward 73 – Kanta Chandra',     16, 1, TRUE),
  ('Ward 74 – Indira Bazar',      16, 1, TRUE),
  ('Ward 75 – Vikas Nagar',       16, 1, TRUE),
  ('Ward 76 – Amani Shah',        16, 1, TRUE),
  ('Ward 77 – Boytawala',         16, 1, TRUE),
  ('Ward 78 – Ajab Nagar',        16, 1, TRUE),
  ('Ward 79 – Kukas Road',        16, 1, TRUE);

-- Amer Zone (wards 80–91) ? north / heritage & rural fringe
INSERT INTO wards (ward_number, zone_id, nigam_id, is_active) VALUES
  ('Ward 80 – Amer',              17, 1, TRUE),
  ('Ward 81 – Nahargarh Road',    17, 1, TRUE),
  ('Ward 82 – Jal Mahal',         17, 1, TRUE),
  ('Ward 83 – Brahmapuri',        17, 1, TRUE),
  ('Ward 84 – Moti Katla',        17, 1, TRUE),
  ('Ward 85 – Kanota',            17, 1, TRUE),
  ('Ward 86 – Kukas',             17, 1, TRUE),
  ('Ward 87 – Paota',             17, 1, TRUE),
  ('Ward 88 – Achrol',            17, 1, TRUE),
  ('Ward 89 – Mauzamabad',        17, 1, TRUE),
  ('Ward 90 – Goner',             17, 1, TRUE),
  ('Ward 91 – Bassi',             17, 1, TRUE);

COMMIT;

-- ?? 5. Verification summary ???????????????????????????????????????????????????
SELECT
  z.id           AS zone_id,
  z.name         AS zone_name,
  COUNT(w.id)    AS ward_count
FROM zones z
LEFT JOIN wards w ON w.zone_id = z.id
WHERE z.nigam_id = 1
GROUP BY z.id, z.name
ORDER BY z.id;
