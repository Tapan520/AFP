# 06 — Database Schema

Postgres. The full DDL is executed idempotently on every .NET startup — see the
`RunSql(...)` block near the top of `Program.cs`. Node's `runMigrations()` runs
a smaller overlapping subset. Both use `CREATE TABLE IF NOT EXISTS` and
`ADD COLUMN IF NOT EXISTS`, so they're safe to re-run.

## Tables

### Geo tree — City ? Nigam ? Zone ? Ward

```
cities   (id, name, state, is_active, created_at)
nigams   (id, city_id FK, name, registration_fee=200, renewal_fee=150, transfer_fee=100, is_active, created_at)
zones    (id, nigam_id FK, name, is_active, created_at)
wards    (id, nigam_id FK NULLABLE, zone_id FK, ward_number, is_active, created_at)
```

Ward `nigam_id` is nullable because zone?nigam relation covers it.

### Users

```
users (
  id, name, mobile UNIQUE, email UNIQUE, password_hash,
  address, role CHECK IN ('citizen','ward_admin','zone_admin',
                          'nigam_admin','city_admin','super_admin'),
  city_id, nigam_id, zone_id, ward_id  (all FK, ON DELETE SET NULL),
  is_active, created_at, updated_at
)
```

Passwords hashed with `crypt(pw, gen_salt('bf', 10))` from `pgcrypto`. Login
verifies with `password_hash = crypt(candidate, password_hash)` (Node uses
bcryptjs; both are compatible).

Seed on startup: **Super Admin** `mobile=9999999999`, `password=Admin@2024`.

### Pets

```
pets (
  id, pet_id UNIQUE (external code), owner_id FK users,
  name, species, breed, colour, gender, date_of_birth,
  registration_status CHECK ('pending','approved','rejected'),
  licence_status, licence_expiry_date, vaccine_next_due,
  photo_url, certificate_url, admin_note, payment_id, txn_ref,
  breeding_opt_in DEFAULT FALSE,
  city_id, nigam_id, zone_id, ward_id,
  created_at, updated_at
)
```

### Reports & Comments

```
reports (
  id, reporter_id FK users, reporter_mobile, report_type,
  last_seen_address, status DEFAULT 'open',
  city_id, nigam_id, zone_id, ward_id,
  resolution_note, resolved_at, resolved_by FK users,
  created_at
)

report_comments (
  id, report_id FK reports, admin_id FK users,
  comment, created_at, updated_at
)
```

### Directory (Doctors + Shops)

```
doctors (id, name, qualification, specialization, clinic_name, address,
         mobile, timings, is_24hr,
         city_id, nigam_id, zone_id, ward_id, is_active, created_at, updated_at)

shops   (id, name, owner_name, address, mobile, timings, speciality,
         city_id, nigam_id, zone_id, ward_id, is_active, created_at, updated_at)
```

### Forum

```
discussions        (id, user_id FK, title (200), body, category DEFAULT 'general',
                    created_at, updated_at)
discussion_replies (id, discussion_id FK, user_id FK, body, created_at, updated_at)
```

## Indexes (created at startup)

```
idx_zones_nigam
idx_users_role, idx_users_mobile, idx_users_city, idx_users_nigam, idx_users_zone, idx_users_ward
idx_pets_owner, idx_pets_status, idx_pets_zone, idx_pets_ward
idx_pets_breeding (partial, breeding_opt_in = TRUE)
idx_doctors_city, idx_doctors_zone
idx_shops_city, idx_shops_zone
idx_rpt_cmts_rid
idx_disc_cat, idx_disc_repl
```

## Role Check Constraint

Kept up-to-date by two `DO $$ … $$` blocks in `Program.cs`:

1. Drops any old `users_role_check` that lacks `zone_admin`.
2. Adds a new constraint that includes `zone_admin` (idempotent).

## Adding a Column

1. Add an `ADD COLUMN IF NOT EXISTS` line to the correct `RunSql("col:...")`
   block in `Program.cs`.
2. If Node needs it too, add the same line to `runMigrations()` in `server.js`.
3. Update this file.

## Adding a Table

1. Add a `RunSql("<table_name>", @"CREATE TABLE IF NOT EXISTS … ")` line.
2. Add associated indexes to the `"indexes"` block.
3. Update this file.
