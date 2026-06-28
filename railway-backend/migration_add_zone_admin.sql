-- =========================================================================
-- migration_add_zone_admin.sql
-- Run on existing afp_nagarnigam database to add zone_admin role.
-- =========================================================================

-- 1. Drop the existing role check constraint (PostgreSQL auto-names it)
DO $$
DECLARE con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'users'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) LIKE '%ward_admin%';
  IF con_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(con_name);
    RAISE NOTICE 'Dropped constraint: %', con_name;
  END IF;
END $$;

-- 2. Recreate with zone_admin included
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('citizen','ward_admin','zone_admin','nigam_admin','city_admin','super_admin'));
