-- ?????????????????????????????????????????????????????????????????????????????
-- seed_test_data.sql  -  AFP Municipal Portal  -  Sample data for quick testing
--
-- Run AFTER schema.sql has created all tables:
--   mysql -u root -proot123 afp_nagarnigam < seed_test_data.sql
--
-- Everything is idempotent (INSERT IGNORE / stable primary keys), so it is
-- safe to re-run the script.
--
-- Login credentials created by this script:
--   super_admin    9999999999 / Admin@123   (already seeded by schema.sql)
--   city_admin     9810000001 / Test@123
--   nigam_admin    9810000002 / Test@123
--   ward_admin(1)  9810000003 / Test@123
--   ward_admin(2)  9810000004 / Test@123
--   citizen (Amit) 9810000101 / Test@123
--   citizen (Neha) 9810000102 / Test@123
--   citizen (Ravi) 9810000103 / Test@123
--
-- Note: bcrypt hash used below is for the password  Test@123  (cost 10).
-- ?????????????????????????????????????????????????????????????????????????????
USE afp_nagarnigam;

-- ?? Geo hierarchy ???????????????????????????????????????????????????????????
-- Cities (Jaipur/Delhi/Mumbai already seeded by schema.sql with ids 1..3).

-- Nigams
INSERT IGNORE INTO nigams (id, city_id, name, registration_fee, renewal_fee, transfer_fee, is_active)
VALUES
  (1, 1, 'Jaipur Nagar Nigam Heritage',       200, 150, 100, 1),
  (2, 1, 'Jaipur Nagar Nigam Greater',        200, 150, 100, 1),
  (3, 2, 'North Delhi Municipal Corp.',       250, 175, 120, 1),
  (4, 2, 'South Delhi Municipal Corp.',       250, 175, 120, 1),
  (5, 3, 'Municipal Corp. of Greater Mumbai', 300, 200, 150, 1);

-- Zones
INSERT IGNORE INTO zones (id, nigam_id, name, is_active) VALUES
  (1, 1, 'Civil Lines Zone', 1),
  (2, 1, 'Hawa Mahal Zone',  1),
  (3, 2, 'Mansarovar Zone',  1),
  (4, 2, 'Sanganer Zone',    1),
  (5, 3, 'Karol Bagh Zone',  1),
  (6, 4, 'Saket Zone',       1),
  (7, 5, 'Bandra Zone',      1);

-- Wards
INSERT IGNORE INTO wards (id, nigam_id, zone_id, ward_number, is_active) VALUES
  (1, 1, 1, 'Ward 1 - Civil Lines',    1),
  (2, 1, 1, 'Ward 2 - Bani Park',      1),
  (3, 1, 2, 'Ward 10 - Chandpole',     1),
  (4, 1, 2, 'Ward 11 - Kishanpole',    1),
  (5, 2, 3, 'Ward 58 - Mansarovar S1', 1),
  (6, 2, 4, 'Ward 47 - Sanganer',      1),
  (7, 3, 5, 'Ward K-1 - Karol Bagh',   1),
  (8, 4, 6, 'Ward S-3 - Saket',        1),
  (9, 5, 7, 'Ward BW-1 - Bandra West', 1);

-- ?? Users (bcrypt hash of "Test@123") ???????????????????????????????????????
-- $2a$10$kskkhPOiYo8Q50bT06a54exOZ4DgXNNw88z9Rg5BJJES8L5ZDiham
INSERT IGNORE INTO users
  (id, name, mobile, email, password_hash, address, role,
   city_id, nigam_id, zone_id, ward_id, is_active)
VALUES
  -- Municipal staff
  (10, 'Priya Sharma',  '9810000001', 'city.jaipur@nn.gov.in',
   '$2a$10$kskkhPOiYo8Q50bT06a54exOZ4DgXNNw88z9Rg5BJJES8L5ZDiham',
   'Nigam HQ, Jaipur', 'city_admin',  1, NULL, NULL, NULL, 1),
  (11, 'Rahul Meena',   '9810000002', 'nigam.heritage@nn.gov.in',
   '$2a$10$kskkhPOiYo8Q50bT06a54exOZ4DgXNNw88z9Rg5BJJES8L5ZDiham',
   'Heritage Nigam Office', 'nigam_admin', 1, 1, NULL, NULL, 1),
  (12, 'Manish Gupta',  '9810000003', 'ward.civillines@nn.gov.in',
   '$2a$10$kskkhPOiYo8Q50bT06a54exOZ4DgXNNw88z9Rg5BJJES8L5ZDiham',
   'Civil Lines Ward Office', 'ward_admin', 1, 1, 1, 1, 1),
  (13, 'Sunita Devi',   '9810000004', 'ward.banipark@nn.gov.in',
   '$2a$10$kskkhPOiYo8Q50bT06a54exOZ4DgXNNw88z9Rg5BJJES8L5ZDiham',
   'Bani Park Ward Office', 'ward_admin', 1, 1, 1, 2, 1),
  -- Citizens
  (20, 'Amit Jain',     '9810000101', 'amit@example.com',
   '$2a$10$kskkhPOiYo8Q50bT06a54exOZ4DgXNNw88z9Rg5BJJES8L5ZDiham',
   'A-12 Bani Park, Jaipur', 'citizen', 1, 1, 1, 2, 1),
  (21, 'Neha Kapoor',   '9810000102', 'neha@example.com',
   '$2a$10$kskkhPOiYo8Q50bT06a54exOZ4DgXNNw88z9Rg5BJJES8L5ZDiham',
   'Mansarovar Sector 5, Jaipur', 'citizen', 1, 2, 3, 5, 1),
  (22, 'Ravi Kumar',    '9810000103', 'ravi@example.com',
   '$2a$10$kskkhPOiYo8Q50bT06a54exOZ4DgXNNw88z9Rg5BJJES8L5ZDiham',
   'Saket M-Block, New Delhi', 'citizen', 2, 4, 6, 8, 1);

-- ?? Pets ????????????????????????????????????????????????????????????????????
INSERT IGNORE INTO pets
  (id, pet_id, owner_id, name, species, breed, colour, gender,
   date_of_birth, registration_status, licence_status, licence_expiry_date,
   vaccine_next_due, city_id, nigam_id, zone_id, ward_id, breeding_opt_in)
VALUES
  (100, 'AFP-JA-0001', 20, 'Bruno',    'dog',    'Labrador',        'Golden',      'male',
    '2021-06-15', 'approved', 'active', DATE_ADD(CURDATE(), INTERVAL  8 MONTH),
    DATE_ADD(CURDATE(), INTERVAL 30 DAY), 1, 1, 1, 2, 1),
  (101, 'AFP-JA-0002', 20, 'Whiskers', 'cat',    'Persian',         'White',       'female',
    '2022-01-20', 'approved', 'active', DATE_ADD(CURDATE(), INTERVAL 10 MONTH),
    DATE_ADD(CURDATE(), INTERVAL 60 DAY), 1, 1, 1, 2, 0),
  (102, 'AFP-JA-0003', 21, 'Rocky',    'dog',    'German Shepherd', 'Black-Tan',   'male',
    '2020-09-01', 'approved', 'active', DATE_ADD(CURDATE(), INTERVAL  5 MONTH),
    DATE_ADD(CURDATE(), INTERVAL  7 DAY), 1, 2, 3, 5, 1),
  (103, 'AFP-JA-0004', 21, 'Coco',     'rabbit', 'Dutch',           'Grey-White',  'female',
    '2023-03-10', 'pending',  'active', NULL,
    NULL,                                     1, 2, 3, 5, 0),
  (104, 'AFP-DE-0001', 22, 'Tommy',    'dog',    'Pug',             'Fawn',        'male',
    '2022-11-05', 'approved', 'active', DATE_ADD(CURDATE(), INTERVAL 11 MONTH),
    DATE_ADD(CURDATE(), INTERVAL 45 DAY), 2, 4, 6, 8, 0),
  (105, 'AFP-DE-0002', 22, 'Mittens',  'cat',    'Domestic Short',  'Tabby',       'female',
    '2023-07-22', 'pending',  'active', NULL,
    NULL,                                     2, 4, 6, 8, 0);

-- ?? Reports ?????????????????????????????????????????????????????????????????
INSERT IGNORE INTO reports
  (id, reporter_id, reporter_mobile, report_type, last_seen_address, status,
   city_id, nigam_id, zone_id, ward_id)
VALUES
  (200, 20, '9810000101', 'stray',      'Near Bani Park bus stop',   'open',
   1, 1, 1, 2),
  (201, 20, '9810000101', 'lost',       'Lost near Central Park',    'open',
   1, 1, 1, 2),
  (202, 21, '9810000102', 'unlicensed', 'Mansarovar Sector 3',       'resolved',
   1, 2, 3, 5),
  (203, 22, '9810000103', 'cruelty',    'Saket M-Block',             'open',
   2, 4, 6, 8);

-- Report comments (staff commenting on reports)
INSERT IGNORE INTO report_comments (id, report_id, admin_id, comment) VALUES
  (300, 200, 13, 'Ward officer dispatched. Will investigate this evening.'),
  (301, 200, 12, 'Please attach a photo when possible.'),
  (302, 202, 13, 'Owner contacted. Licence renewal in progress.');

-- ?? Community forum ?????????????????????????????????????????????????????????
INSERT IGNORE INTO discussions (id, user_id, title, body, category) VALUES
  (400, 20, 'Best dry food for Labradors?',
   'My 2-year-old Bruno is fussy. Any brand recommendations that worked for your dogs?',
   'nutrition'),
  (401, 21, 'German Shepherd tick problem in monsoon',
   'Rocky keeps getting ticks despite using standard shampoo. Any effective preventive tips?',
   'health'),
  (402, 22, 'Lost Pug in Saket area - please help',
   'Tommy escaped from the balcony yesterday morning. He is fawn coloured and answers to Tommy. Contact 9810000103.',
   'lostfound'),
  (403, 20, 'Training a rescue kitten - patience tips',
   'Adopted a 3-month-old kitten last week. What worked best for socialisation in the first month?',
   'training');

INSERT IGNORE INTO discussion_replies (id, discussion_id, user_id, body) VALUES
  (500, 400, 21, 'We use Royal Canin large-breed adult - very good acceptance.'),
  (501, 400, 22, 'Pedigree Pro Adult worked well for my Lab too. Mix with warm water.'),
  (502, 401, 20, 'Try Bravecto chews (vet prescription). Lasts 12 weeks.'),
  (503, 402, 21, 'Sharing on my local group. Fingers crossed!');

-- ?? Doctors / Vets ??????????????????????????????????????????????????????????
INSERT IGNORE INTO doctors
  (id, name, qualification, specialization, clinic_name, address, mobile,
   timings, is_24hr, city_id, nigam_id, zone_id, ward_id, is_active)
VALUES
  (600, 'Dr. Rajesh Verma',  'BVSc, MVSc', 'Small animals',   'Verma Pet Clinic',
   'Shop 4, C-Scheme, Jaipur',    '9812345601', '9am - 8pm',       0, 1, 1, 1, 1, 1),
  (601, 'Dr. Anita Sharma',  'BVSc',       'Cats & exotics',  'Purrfect Vet Care',
   'Bani Park Main Road',         '9812345602', '10am - 7pm',      0, 1, 1, 1, 2, 1),
  (602, 'Dr. Vikram Singh',  'BVSc, MVSc', '24/7 emergency',  'Jaipur Pet Hospital',
   'Mansarovar Central',          '9812345603', '24 hrs',          1, 1, 2, 3, 5, 1),
  (603, 'Dr. Meera Iyer',    'BVSc',       'Dermatology',     'Paws & Care Clinic',
   'Saket M-Block, Delhi',        '9812345604', '11am - 6pm',      0, 2, 4, 6, 8, 1),
  (604, 'Dr. Sameer Patil',  'BVSc, MVSc', 'Orthopaedics',    'Bandra Vet Hospital',
   'Linking Road, Bandra West',   '9812345605', '9am - 9pm',       0, 3, 5, 7, 9, 1);

-- ?? Pet food / accessory shops ??????????????????????????????????????????????
INSERT IGNORE INTO shops
  (id, name, owner_name, address, mobile, timings, speciality,
   city_id, nigam_id, zone_id, ward_id, is_active)
VALUES
  (700, 'Paws & Claws',        'Amit Bhandari', 'C-Scheme, Jaipur',            '9822345701',
   '10am - 9pm',  'Premium dog & cat food',    1, 1, 1, 1, 1),
  (701, 'The Pet Corner',      'Neha Agarwal',  'Bani Park, Jaipur',           '9822345702',
   '9am - 8pm',   'Accessories & toys',        1, 1, 1, 2, 1),
  (702, 'Mansarovar Pet Mart', 'Suresh Kumar',  'Mansarovar Sec 3, Jaipur',    '9822345703',
   '10am - 10pm', 'Aquariums & bird supplies', 1, 2, 3, 5, 1),
  (703, 'Saket Pet Store',     'Deepak Sharma', 'Saket Main Market, Delhi',    '9822345704',
   '11am - 9pm',  'Grooming products',         2, 4, 6, 8, 1),
  (704, 'Bandra Barks',        'Raj Malhotra',  'Hill Road, Bandra West',      '9822345705',
   '10am - 11pm', 'Organic pet food',          3, 5, 7, 9, 1);

-- ?? Summary ?????????????????????????????????????????????????????????????????
SELECT 'Seed complete' AS status,
       (SELECT COUNT(*) FROM users)              AS users,
       (SELECT COUNT(*) FROM pets)               AS pets,
       (SELECT COUNT(*) FROM reports)            AS reports,
       (SELECT COUNT(*) FROM discussions)        AS discussions,
       (SELECT COUNT(*) FROM discussion_replies) AS replies,
       (SELECT COUNT(*) FROM doctors)            AS doctors,
       (SELECT COUNT(*) FROM shops)              AS shops,
       (SELECT COUNT(*) FROM nigams)             AS nigams,
       (SELECT COUNT(*) FROM zones)              AS zones,
       (SELECT COUNT(*) FROM wards)              AS wards;
