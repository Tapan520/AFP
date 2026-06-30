using Npgsql;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

// Railway injects PORT at runtime � bind to it so the service is reachable
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

builder.Services.AddRazorPages();
builder.Services.AddHttpClient();

// Direct DB connection - implements discussion forum without relying on the old backend
// Supports both Railway private (.railway.internal - no SSL) and public URLs (SSL required)
var dbConnStr = Environment.GetEnvironmentVariable("DATABASE_URL");
NpgsqlDataSource? dbSource = null;
string? dbInitError = null;
string? dbHost = null;
string? dbConnectError = null;

NpgsqlConnectionStringBuilder? ParseUrl(string url)
{
    var s = url.Trim();
    if      (s.StartsWith("postgresql://")) s = s.Substring("postgresql://".Length);
    else if (s.StartsWith("postgres://"))   s = s.Substring("postgres://".Length);
    else return null;

    var atIdx = s.LastIndexOf('@');
    if (atIdx < 0) return null;
    var userInfo = s.Substring(0, atIdx);
    var hostPart = s.Substring(atIdx + 1);

    var ci   = userInfo.IndexOf(':');
    var user = ci >= 0 ? userInfo.Substring(0, ci) : userInfo;
    var pass = ci >= 0 ? userInfo.Substring(ci + 1) : "";

    var si       = hostPart.IndexOf('/');
    var hostPort = si >= 0 ? hostPart.Substring(0, si) : hostPart;
    var database = si >= 0 ? hostPart.Substring(si + 1) : "railway";

    var pi      = hostPort.LastIndexOf(':');
    var host    = pi >= 0 ? hostPort.Substring(0, pi) : hostPort;
    var portStr = pi >= 0 ? hostPort.Substring(pi + 1) : "5432";

    // Railway internal hostname = no SSL; public proxy = require SSL
    var isInternal = host.EndsWith(".railway.internal", StringComparison.OrdinalIgnoreCase);

    return new NpgsqlConnectionStringBuilder
    {
        Host                   = host,
        Port                   = int.TryParse(portStr, out var p) ? p : 5432,
        Database               = database,
        Username               = Uri.UnescapeDataString(user),
        Password               = Uri.UnescapeDataString(pass),
        SslMode                = isInternal ? SslMode.Disable : SslMode.Prefer,
        TrustServerCertificate = true,
        Timeout                = 10,
        CommandTimeout         = 15,
    };
}

try
{
    NpgsqlConnectionStringBuilder? csb = null;

    // Strategy 1: individual PG* vars Railway can inject via Reference Variable
    var pgHost = Environment.GetEnvironmentVariable("PGHOST");
    var pgUser = Environment.GetEnvironmentVariable("PGUSER");
    if (!string.IsNullOrEmpty(pgHost) && !string.IsNullOrEmpty(pgUser))
    {
        var pgPort = Environment.GetEnvironmentVariable("PGPORT") ?? "5432";
        var pgPass = Environment.GetEnvironmentVariable("PGPASSWORD") ?? "";
        var pgDb   = Environment.GetEnvironmentVariable("PGDATABASE") ?? "railway";
        var isInt  = pgHost.EndsWith(".railway.internal", StringComparison.OrdinalIgnoreCase);
        csb = new NpgsqlConnectionStringBuilder
        {
            Host                   = pgHost,
            Port                   = int.TryParse(pgPort, out var pp) ? pp : 5432,
            Database               = pgDb,
            Username               = pgUser,
            Password               = pgPass,
            SslMode                = isInt ? SslMode.Disable : SslMode.Prefer,
            TrustServerCertificate = true,
            Timeout                = 10,
            CommandTimeout         = 15,
        };
        dbHost = $"{pgHost}:{pgPort}/{pgDb}";
        Console.WriteLine($"DB: using PG* vars → {dbHost}");
    }
    else if (!string.IsNullOrEmpty(dbConnStr))
    {
        csb = ParseUrl(dbConnStr);
        if (csb != null)
        {
            dbHost = $"{csb.Host}:{csb.Port}/{csb.Database}";
            Console.WriteLine($"DB: using DATABASE_URL → {dbHost}");
        }
        else
        {
            dbInitError = "DATABASE_URL format not recognised";
        }
    }
    else
    {
        dbInitError = "No DATABASE_URL or PGHOST found in environment";
    }

    if (csb != null)
        dbSource = NpgsqlDataSource.Create(csb.ConnectionString);
}
catch (Exception ex)
{
    dbInitError = ex.Message;
    Console.WriteLine($"DB init error: {ex.Message}");
}

// Test the connection eagerly so problems show up in /api/dbstatus → db:"error"
if (dbSource != null)
{
    try
    {
        await using var tc  = await dbSource.OpenConnectionAsync();
        await using var tcm = tc.CreateCommand();
        tcm.CommandText = "SELECT 1";
        await tcm.ExecuteScalarAsync();
        Console.WriteLine($"DB connection OK: {dbHost}");
    }
    catch (Exception ex)
    {
        dbConnectError = ex.Message;
        Console.WriteLine($"DB connect test failed: {ex.Message}");
    }
}

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

// Note: HTTPS redirection is intentionally omitted � Railway terminates TLS
// at the edge proxy, so enforcing it inside the container causes redirect loops.
app.UseStaticFiles();
app.UseRouting();
app.UseAuthorization();
app.MapRazorPages();

// Run full database migration on every startup - all steps are idempotent (safe to re-run)
if (dbSource != null)
{
    async Task RunSql(string label, string sql)
    {
        try
        {
            await using var c = await dbSource.OpenConnectionAsync();
            await using var m = c.CreateCommand();
            m.CommandText = sql;
            await m.ExecuteNonQueryAsync();
            Console.WriteLine($"Migration OK: {label}");
        }
        catch (Exception ex) { Console.WriteLine($"Migration [{label}]: {ex.Message}"); }
    }

    // ── Tables ────────────────────────────────────────────────────────────────
    await RunSql("pgcrypto",        "CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    await RunSql("cities",          @"CREATE TABLE IF NOT EXISTS cities (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, state VARCHAR(100), is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("nigams",          @"CREATE TABLE IF NOT EXISTS nigams (id SERIAL PRIMARY KEY, city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE, name VARCHAR(150) NOT NULL, registration_fee NUMERIC(10,2) NOT NULL DEFAULT 200, renewal_fee NUMERIC(10,2) NOT NULL DEFAULT 150, transfer_fee NUMERIC(10,2) NOT NULL DEFAULT 100, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("zones",           @"CREATE TABLE IF NOT EXISTS zones (id SERIAL PRIMARY KEY, nigam_id INTEGER NOT NULL REFERENCES nigams(id) ON DELETE CASCADE, name VARCHAR(150) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("wards",           @"CREATE TABLE IF NOT EXISTS wards (id SERIAL PRIMARY KEY, nigam_id INTEGER REFERENCES nigams(id) ON DELETE SET NULL, zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL, ward_number VARCHAR(80) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("users",           @"CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL, mobile VARCHAR(15) NOT NULL UNIQUE, email VARCHAR(180) UNIQUE, password_hash TEXT NOT NULL, address TEXT, role VARCHAR(20) NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen','ward_admin','zone_admin','nigam_admin','city_admin','super_admin')), city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL, nigam_id INTEGER REFERENCES nigams(id) ON DELETE SET NULL, zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL, ward_id INTEGER REFERENCES wards(id) ON DELETE SET NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("pets",            @"CREATE TABLE IF NOT EXISTS pets (id SERIAL PRIMARY KEY, pet_id VARCHAR(30) UNIQUE, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(80) NOT NULL, species VARCHAR(30) NOT NULL, breed VARCHAR(80), colour VARCHAR(60), gender VARCHAR(10), date_of_birth DATE, registration_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (registration_status IN ('pending','approved','rejected')), licence_status VARCHAR(30) DEFAULT 'active', licence_expiry_date DATE, vaccine_next_due DATE, photo_url TEXT, certificate_url TEXT, admin_note TEXT, payment_id VARCHAR(100), txn_ref VARCHAR(100), breeding_opt_in BOOLEAN NOT NULL DEFAULT FALSE, city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL, nigam_id INTEGER REFERENCES nigams(id) ON DELETE SET NULL, zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL, ward_id INTEGER REFERENCES wards(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("reports",         @"CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL, reporter_mobile VARCHAR(15), report_type VARCHAR(30), last_seen_address TEXT, status VARCHAR(20) NOT NULL DEFAULT 'open', city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL, nigam_id INTEGER REFERENCES nigams(id) ON DELETE SET NULL, zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL, ward_id INTEGER REFERENCES wards(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("report_comments", @"CREATE TABLE IF NOT EXISTS report_comments (id SERIAL PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE, admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, comment TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("doctors",         @"CREATE TABLE IF NOT EXISTS doctors (id SERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL, qualification VARCHAR(120), specialization VARCHAR(120), clinic_name VARCHAR(150), address TEXT, mobile VARCHAR(15), timings VARCHAR(100), is_24hr BOOLEAN NOT NULL DEFAULT FALSE, city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL, nigam_id INTEGER REFERENCES nigams(id) ON DELETE SET NULL, zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL, ward_id INTEGER REFERENCES wards(id) ON DELETE SET NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("shops",           @"CREATE TABLE IF NOT EXISTS shops (id SERIAL PRIMARY KEY, name VARCHAR(150) NOT NULL, owner_name VARCHAR(120), address TEXT, mobile VARCHAR(15), timings VARCHAR(100), speciality VARCHAR(150), city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL, nigam_id INTEGER REFERENCES nigams(id) ON DELETE SET NULL, zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL, ward_id INTEGER REFERENCES wards(id) ON DELETE SET NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("discussions",     @"CREATE TABLE IF NOT EXISTS discussions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title VARCHAR(200) NOT NULL, body TEXT NOT NULL, category VARCHAR(50) NOT NULL DEFAULT 'general', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
    await RunSql("disc_replies",    @"CREATE TABLE IF NOT EXISTS discussion_replies (id SERIAL PRIMARY KEY, discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");

    // ── Column migrations (safe on existing databases) ────────────────────────
    await RunSql("col:nigam fees",    @"ALTER TABLE nigams ADD COLUMN IF NOT EXISTS registration_fee NUMERIC(10,2) NOT NULL DEFAULT 200; ALTER TABLE nigams ADD COLUMN IF NOT EXISTS renewal_fee NUMERIC(10,2) NOT NULL DEFAULT 150; ALTER TABLE nigams ADD COLUMN IF NOT EXISTS transfer_fee NUMERIC(10,2) NOT NULL DEFAULT 100;");
    await RunSql("col:wards zone_id", @"ALTER TABLE wards ALTER COLUMN nigam_id DROP NOT NULL; ALTER TABLE wards ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL;");
    await RunSql("col:zone_id all",   @"ALTER TABLE users   ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL; ALTER TABLE pets    ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL; ALTER TABLE doctors ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL; ALTER TABLE shops   ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL;");
    await RunSql("col:reports geo",   @"ALTER TABLE reports ADD COLUMN IF NOT EXISTS city_id  INTEGER REFERENCES cities(id)  ON DELETE SET NULL; ALTER TABLE reports ADD COLUMN IF NOT EXISTS nigam_id INTEGER REFERENCES nigams(id) ON DELETE SET NULL; ALTER TABLE reports ADD COLUMN IF NOT EXISTS zone_id  INTEGER REFERENCES zones(id)  ON DELETE SET NULL; ALTER TABLE reports ADD COLUMN IF NOT EXISTS ward_id  INTEGER REFERENCES wards(id)  ON DELETE SET NULL;");
    await RunSql("col:pets breeding",    @"ALTER TABLE pets ADD COLUMN IF NOT EXISTS breeding_opt_in BOOLEAN NOT NULL DEFAULT FALSE;");
    await RunSql("col:reports resolve",  @"ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_note TEXT; ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ; ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;");

    // ── Backfill columns missing from the original Node.js schema ─────────────
    // These were absent in the old backend's CREATE TABLE statements.
    // ADD COLUMN IF NOT EXISTS is idempotent and safe to re-run.
    await RunSql("col:users is_active+updated_at", @"
        ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active  BOOLEAN     NOT NULL DEFAULT TRUE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE users ADD COLUMN IF NOT EXISTS city_id    INTEGER REFERENCES cities(id)  ON DELETE SET NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS nigam_id   INTEGER REFERENCES nigams(id)  ON DELETE SET NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS ward_id    INTEGER REFERENCES wards(id)   ON DELETE SET NULL;");
    await RunSql("col:pets updated_at", @"
        ALTER TABLE pets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE pets ADD COLUMN IF NOT EXISTS city_id    INTEGER REFERENCES cities(id)  ON DELETE SET NULL;
        ALTER TABLE pets ADD COLUMN IF NOT EXISTS nigam_id   INTEGER REFERENCES nigams(id)  ON DELETE SET NULL;
        ALTER TABLE pets ADD COLUMN IF NOT EXISTS ward_id    INTEGER REFERENCES wards(id)   ON DELETE SET NULL;");
    await RunSql("col:doctors updated_at+is_active", @"
        ALTER TABLE doctors ADD COLUMN IF NOT EXISTS is_active  BOOLEAN     NOT NULL DEFAULT TRUE;
        ALTER TABLE doctors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE doctors ADD COLUMN IF NOT EXISTS city_id    INTEGER REFERENCES cities(id)  ON DELETE SET NULL;
        ALTER TABLE doctors ADD COLUMN IF NOT EXISTS nigam_id   INTEGER REFERENCES nigams(id)  ON DELETE SET NULL;
        ALTER TABLE doctors ADD COLUMN IF NOT EXISTS ward_id    INTEGER REFERENCES wards(id)   ON DELETE SET NULL;");
    await RunSql("col:shops updated_at+is_active", @"
        ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_active  BOOLEAN     NOT NULL DEFAULT TRUE;
        ALTER TABLE shops ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE shops ADD COLUMN IF NOT EXISTS city_id    INTEGER REFERENCES cities(id)  ON DELETE SET NULL;
        ALTER TABLE shops ADD COLUMN IF NOT EXISTS nigam_id   INTEGER REFERENCES nigams(id)  ON DELETE SET NULL;
        ALTER TABLE shops ADD COLUMN IF NOT EXISTS ward_id    INTEGER REFERENCES wards(id)   ON DELETE SET NULL;");
    await RunSql("col:reports reporter_mobile+type", @"
        ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_mobile   VARCHAR(15);
        ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_type       VARCHAR(30);
        ALTER TABLE reports ADD COLUMN IF NOT EXISTS last_seen_address TEXT;
        ALTER TABLE reports ADD COLUMN IF NOT EXISTS status            VARCHAR(20) NOT NULL DEFAULT 'open';");

    // ── Ensure geo-lookup tables have all columns the app depends on ──────────
    // Covers the case where the Node.js backend seeded these tables with a
    // minimal schema that did not include is_active / state.
    await RunSql("col:cities state+active", @"
        ALTER TABLE cities ADD COLUMN IF NOT EXISTS state     VARCHAR(100);
        ALTER TABLE cities ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;");
    await RunSql("col:nigams is_active", @"
        ALTER TABLE nigams ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;");
    await RunSql("col:zones is_active", @"
        ALTER TABLE zones  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;");
    await RunSql("col:wards is_active", @"
        ALTER TABLE wards  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;");

    // ── Ensure discussion / reply / report-comment tables have updated_at ─────
    // UPDATE ...SET updated_at = NOW() fails if the column is absent.
    // The Node.js backend may have created these tables without it.
    await RunSql("col:discussions updated_at", @"
        ALTER TABLE discussions        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE discussion_replies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE report_comments    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();");

    // ── Indexes ───────────────────────────────────────────────────────────────
    await RunSql("indexes", @"
        CREATE INDEX IF NOT EXISTS idx_zones_nigam   ON zones(nigam_id);
        CREATE INDEX IF NOT EXISTS idx_users_role    ON users(role);
        CREATE INDEX IF NOT EXISTS idx_users_mobile  ON users(mobile);
        CREATE INDEX IF NOT EXISTS idx_users_city    ON users(city_id);
        CREATE INDEX IF NOT EXISTS idx_users_nigam   ON users(nigam_id);
        CREATE INDEX IF NOT EXISTS idx_users_zone    ON users(zone_id);
        CREATE INDEX IF NOT EXISTS idx_users_ward    ON users(ward_id);
        CREATE INDEX IF NOT EXISTS idx_pets_owner    ON pets(owner_id);
        CREATE INDEX IF NOT EXISTS idx_pets_status   ON pets(registration_status);
        CREATE INDEX IF NOT EXISTS idx_pets_zone     ON pets(zone_id);
        CREATE INDEX IF NOT EXISTS idx_pets_ward     ON pets(ward_id);
        CREATE INDEX IF NOT EXISTS idx_pets_breeding ON pets(breeding_opt_in) WHERE breeding_opt_in = TRUE;
        CREATE INDEX IF NOT EXISTS idx_doctors_city  ON doctors(city_id);
        CREATE INDEX IF NOT EXISTS idx_doctors_zone  ON doctors(zone_id);
        CREATE INDEX IF NOT EXISTS idx_shops_city    ON shops(city_id);
        CREATE INDEX IF NOT EXISTS idx_shops_zone    ON shops(zone_id);
        CREATE INDEX IF NOT EXISTS idx_rpt_cmts_rid  ON report_comments(report_id);
        CREATE INDEX IF NOT EXISTS idx_disc_cat      ON discussions(category);
        CREATE INDEX IF NOT EXISTS idx_disc_repl     ON discussion_replies(discussion_id);");

    // ── Update role constraint to include zone_admin ──────────────────────────
    await RunSql("role:drop old", @"
        DO $$
        BEGIN
          EXECUTE COALESCE(
            (SELECT 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(conname)
             FROM pg_constraint
             WHERE conrelid = 'users'::regclass AND contype = 'c'
               AND pg_get_constraintdef(oid) LIKE '%ward_admin%'
               AND pg_get_constraintdef(oid) NOT LIKE '%zone_admin%'
             LIMIT 1),
            'SELECT 1');
        END $$;");
    await RunSql("role:add zone_admin", @"
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'users'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%zone_admin%'
          ) THEN
            ALTER TABLE users ADD CONSTRAINT users_role_check
              CHECK (role IN ('citizen','ward_admin','zone_admin','nigam_admin','city_admin','super_admin'));
          END IF;
        END $$;");

    // ── Seed data ─────────────────────────────────────────────────────────────
    await RunSql("seed:cities", @"
        INSERT INTO cities (name, state) VALUES
          ('Jaipur','Rajasthan'),('Delhi','Delhi'),('Mumbai','Maharashtra')
        ON CONFLICT DO NOTHING;");

    await RunSql("seed:nigam", @"
        INSERT INTO nigams (id, city_id, name, is_active)
        SELECT 1, c.id, 'Jaipur Municipal Corporation', TRUE
        FROM cities c WHERE c.name = 'Jaipur'
          AND NOT EXISTS (SELECT 1 FROM nigams WHERE id = 1);");

    await RunSql("seed:zones", @"
        INSERT INTO zones (id, nigam_id, name, is_active) VALUES
          (10,1,'Heritage Zone',TRUE),(11,1,'Civil Lines Zone',TRUE),
          (12,1,'Sindhi Camp Zone',TRUE),(13,1,'Vidyadhar Nagar Zone',TRUE),
          (14,1,'Sanganer Zone',TRUE),(15,1,'Mansarovar Zone',TRUE),
          (16,1,'Jhotwara Zone',TRUE),(17,1,'Amer Zone',TRUE)
        ON CONFLICT (id) DO NOTHING;
        SELECT setval('zones_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM zones), 17), 17));");

    await RunSql("seed:wards", @"
        INSERT INTO wards (ward_number, zone_id, nigam_id, is_active)
        SELECT t.wn, t.zid::int, 1, TRUE FROM (VALUES
          ('Ward 1 - Tripolia Bazar',10),('Ward 2 - Johari Bazar',10),('Ward 3 - Chandpole Bazar',10),
          ('Ward 4 - Kishan Pole',10),('Ward 5 - Suraj Pole',10),('Ward 6 - Ghat Gate',10),
          ('Ward 7 - New Gate',10),('Ward 8 - Sanganeri Gate',10),('Ward 9 - Ajmeri Gate',10),
          ('Ward 10 - Chand Pole Gate',10),('Ward 11 - Ram Chandra Ji',10),('Ward 12 - Brahmpuri',10),
          ('Ward 13 - Topkhana Desh',10),('Ward 14 - Ramganj Bazar',10),
          ('Ward 15 - Civil Lines',11),('Ward 16 - Ram Niwas Garden',11),('Ward 17 - Collectorate',11),
          ('Ward 18 - Bais Godam',11),('Ward 19 - Maharani Farm',11),('Ward 20 - Adarsh Nagar',11),
          ('Ward 21 - Lal Kothi',11),('Ward 22 - Tilak Nagar',11),('Ward 23 - Nirman Nagar',11),
          ('Ward 24 - Shastri Nagar',11),('Ward 25 - Gandhi Nagar',11),
          ('Ward 26 - Sindhi Camp',12),('Ward 27 - Railway Station',12),('Ward 28 - Gopalbari',12),
          ('Ward 29 - Nehru Nagar',12),('Ward 30 - Khatipura',12),('Ward 31 - Janta Colony',12),
          ('Ward 32 - Sodala',12),('Ward 33 - Shyam Nagar',12),('Ward 34 - Naveen Shahdara',12),
          ('Ward 35 - Idgah',12),
          ('Ward 36 - Vidyadhar Nagar',13),('Ward 37 - Sanjay Nagar',13),('Ward 38 - Jawahar Nagar',13),
          ('Ward 39 - Sikar Road',13),('Ward 40 - Vidhayak Puri',13),('Ward 41 - Durgapura',13),
          ('Ward 42 - Sector 7 VN',13),('Ward 43 - Heera Path',13),('Ward 44 - Indira Gandhi Nagar',13),
          ('Ward 45 - Triveni Nagar',13),('Ward 46 - Transport Nagar',13),
          ('Ward 47 - Sanganer',14),('Ward 48 - Jaipur Airport',14),('Ward 49 - Bagru Road',14),
          ('Ward 50 - Sitapura',14),('Ward 51 - Pratap Nagar',14),('Ward 52 - Dher Ka Balaji',14),
          ('Ward 53 - Muhana',14),('Ward 54 - Chaksu Road',14),('Ward 55 - Govind Nagar',14),
          ('Ward 56 - Kalwar Road',14),('Ward 57 - Harmara',14),
          ('Ward 58 - Mansarovar Sec 1',15),('Ward 59 - Mansarovar Sec 2',15),
          ('Ward 60 - Mansarovar Sec 3',15),('Ward 61 - Mansarovar Sec 4',15),
          ('Ward 62 - Mansarovar Sec 5',15),('Ward 63 - Jagatpura',15),
          ('Ward 64 - Tonk Road',15),('Ward 65 - Malviya Nagar',15),('Ward 66 - Chitrakoot',15),
          ('Ward 67 - Lalarpura',15),('Ward 68 - Ramnagar',15),
          ('Ward 69 - Jhotwara',16),('Ward 70 - Vidhyut Nagar',16),('Ward 71 - Shri Kishan Nagar',16),
          ('Ward 72 - Moti Doongri Road',16),('Ward 73 - Kanta Chandra',16),('Ward 74 - Indira Bazar',16),
          ('Ward 75 - Vikas Nagar',16),('Ward 76 - Amani Shah',16),('Ward 77 - Boytawala',16),
          ('Ward 78 - Ajab Nagar',16),('Ward 79 - Kukas Road',16),
          ('Ward 80 - Amer',17),('Ward 81 - Nahargarh Road',17),('Ward 82 - Jal Mahal',17),
          ('Ward 83 - Brahmapuri',17),('Ward 84 - Moti Katla',17),('Ward 85 - Kanota',17),
          ('Ward 86 - Kukas',17),('Ward 87 - Paota',17),('Ward 88 - Achrol',17),
          ('Ward 89 - Mauzamabad',17),('Ward 90 - Goner',17),('Ward 91 - Bassi',17)
        ) AS t(wn, zid)
        WHERE NOT EXISTS (SELECT 1 FROM wards w WHERE w.zone_id = t.zid::int);");

    await RunSql("seed:super_admin", @"
        INSERT INTO users (name, mobile, email, password_hash, role, is_active) VALUES
          ('Super Admin','9999999999','admin@nagarnigam.gov.in',
           crypt('Admin@2024', gen_salt('bf', 10)),'super_admin',TRUE)
        ON CONFLICT (mobile) DO UPDATE
          SET password_hash = crypt('Admin@2024', gen_salt('bf', 10)),
              role          = EXCLUDED.role,
              email         = EXCLUDED.email,
              is_active     = TRUE;");

    Console.WriteLine("All migrations complete.");
}

// ?? Proxy base URL ????????????????????????????????????????????????????????????
// Dev  ? local Node/Express on port 3000
// Prod ? Railway backend (override with BACKEND_URL env var on Railway)
var backendBase = Environment.GetEnvironmentVariable("BACKEND_URL")
    ?? (app.Environment.IsDevelopment()
        ? "http://localhost:3000"
        : "https://web-production-06875.up.railway.app");

// ?? Shared proxy helpers ??????????????????????????????????????????????????????
static HttpClient MakeClient(IHttpClientFactory f, HttpRequest req)
{
    var c    = f.CreateClient();
    var auth = req.Headers["Authorization"].FirstOrDefault();
    if (!string.IsNullOrEmpty(auth))
        c.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", auth);
    return c;
}

// Safely forward a GET response, returning a 502 JSON error if Node is down.
static async Task<IResult> SafeGet(HttpResponseMessage resp, string fallback = "")
{
    var body = await resp.Content.ReadAsStringAsync();
    return Results.Content(
        body.Length > 0 ? body : (fallback.Length > 0 ? fallback : "{}"),
        "application/json",
        statusCode: (int)resp.StatusCode);
}

// Decode JWT payload to extract user id (token already issued by the Node backend).
static int? GetUserId(HttpRequest req)
{
    var auth = req.Headers["Authorization"].FirstOrDefault();
    if (string.IsNullOrEmpty(auth) || !auth.StartsWith("Bearer ")) return null;
    var parts = auth.Substring(7).Split('.');
    if (parts.Length != 3) return null;
    try
    {
        var padded = parts[1].PadRight(parts[1].Length + (4 - parts[1].Length % 4) % 4, '=');
        var jStr   = System.Text.Encoding.UTF8.GetString(
                         Convert.FromBase64String(padded.Replace('-', '+').Replace('_', '/')));
        using var jDoc = System.Text.Json.JsonDocument.Parse(jStr);
        if (jDoc.RootElement.TryGetProperty("id", out var el) && el.TryGetInt32(out var uid))
            return uid;
    }
    catch { }
    return null;
}

// Read all rows from NpgsqlDataReader into list of dictionaries.
static async Task<List<Dictionary<string, object?>>> ReadRows(NpgsqlDataReader reader)
{
    var rows = new List<Dictionary<string, object?>>();
    while (await reader.ReadAsync())
    {
        var row = new Dictionary<string, object?>();
        for (int i = 0; i < reader.FieldCount; i++)
        {
            var v = reader.GetValue(i);
            row[reader.GetName(i)] = v is DBNull ? null : v;
        }
        rows.Add(row);
    }
    return rows;
}

// ?? Auth proxy ????????????????????????????????????????????????????????????????
// POST /api/auth/login   POST /api/auth/register
app.MapPost("/api/auth/{action}", async (string action, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var json = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp = await MakeClient(f, ctx.Request).PostAsync(
            $"{backendBase}/api/auth/{action}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Geo proxy ?????????????????????????????????????????????????????????????????
// GET /api/geo/cities  GET /api/geo/nigams  GET /api/geo/wards
// GET /api/geo/cities/all  GET /api/geo/nigams/all  GET /api/geo/wards/all
app.MapGet("/api/geo/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs      = ctx.Request.QueryString.Value ?? "";
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var resp    = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/geo{segment}{qs}");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPost("/api/geo/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var json    = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp    = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/geo{segment}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapPut("/api/geo/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var json    = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp    = await MakeClient(f, ctx.Request).PutAsync($"{backendBase}/api/geo{segment}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Pets – direct DB endpoints (stats / search / breeding / adoption) ??????????
// Registered before the catch-all proxy so they take routing precedence.

app.MapGet("/api/pets/stats", async () =>
{
    if (dbSource == null) return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        await using var conn  = await dbSource.OpenConnectionAsync();
        await using var cmd   = conn.CreateCommand();
        cmd.CommandText = """
            SELECT
              COUNT(*)::int                                                                     AS "totalPets",
              COUNT(*) FILTER (WHERE registration_status='approved'
                AND (licence_expiry_date IS NULL OR licence_expiry_date >= NOW()))::int         AS "activeLicences",
              COUNT(*) FILTER (WHERE registration_status='pending')::int                       AS "pendingCount"
            FROM pets
            """;
        await using var rdr  = await cmd.ExecuteReaderAsync();
        var totals = (await ReadRows(rdr)).FirstOrDefault() ?? new();
        await rdr.DisposeAsync(); await cmd.DisposeAsync();
        await using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = """
            SELECT c.name,
                   COUNT(p.id)::int                                               AS total,
                   COUNT(p.id) FILTER (WHERE p.species='dog')::int               AS dogs,
                   COUNT(p.id) FILTER (WHERE p.species='cat')::int               AS cats,
                   COUNT(p.id) FILTER (WHERE p.species NOT IN ('dog','cat'))::int AS others
            FROM cities c LEFT JOIN pets p ON p.city_id = c.id
            GROUP BY c.id ORDER BY total DESC
            """;
        await using var rdr2 = await cmd2.ExecuteReaderAsync();
        totals["cities"] = await ReadRows(rdr2);
        return Results.Json(totals);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapGet("/api/pets/search", async (HttpContext ctx) =>
{
    if (dbSource == null) return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        var q      = ctx.Request.Query["q"].FirstOrDefault()      ?? "";
        var cityId = ctx.Request.Query["cityId"].FirstOrDefault() ?? "";
        var where  = new List<string> { "p.registration_status = 'approved'" };
        var parms  = new List<NpgsqlParameter>();
        int n = 1;
        if (!string.IsNullOrEmpty(q))
        {
            where.Add($"(p.name ILIKE ${n} OR u.name ILIKE ${n} OR p.pet_id ILIKE ${n})");
            n++;
            parms.Add(new NpgsqlParameter { Value = $"%{q}%" });
        }
        if (!string.IsNullOrEmpty(cityId) && int.TryParse(cityId, out var ci))
            { where.Add($"p.city_id = ${n++}"); parms.Add(new NpgsqlParameter { Value = ci }); }
        var ws = "WHERE " + string.Join(" AND ", where);
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT p.*, u.name AS owner_name, u.mobile AS owner_mobile,
                   c.name AS city_name, ng.name AS nigam_name, w.ward_number
            FROM pets p
            LEFT JOIN users  u  ON u.id  = p.owner_id
            LEFT JOIN cities c  ON c.id  = p.city_id
            LEFT JOIN nigams ng ON ng.id = p.nigam_id
            LEFT JOIN wards  w  ON w.id  = p.ward_id
            {ws}
            ORDER BY p.name LIMIT 50
            """;
        foreach (var pm in parms) cmd.Parameters.Add(pm);
        await using var rdr = await cmd.ExecuteReaderAsync();
        return Results.Json(await ReadRows(rdr));
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapGet("/api/pets/breeding", async (HttpContext ctx) =>
{
    if (dbSource == null) return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        var species = ctx.Request.Query["species"].FirstOrDefault() ?? "";
        var breed   = ctx.Request.Query["breed"].FirstOrDefault()   ?? "";
        var gender  = ctx.Request.Query["gender"].FirstOrDefault()  ?? "";
        var cityId  = ctx.Request.Query["cityId"].FirstOrDefault()  ?? "";
        var where   = new List<string> { "p.registration_status = 'approved'", "p.breeding_opt_in = TRUE" };
        var parms   = new List<NpgsqlParameter>();
        int n = 1;
        if (!string.IsNullOrEmpty(species)) { where.Add($"p.species = ${n++}");   parms.Add(new NpgsqlParameter { Value = species }); }
        if (!string.IsNullOrEmpty(breed))   { where.Add($"p.breed ILIKE ${n++}"); parms.Add(new NpgsqlParameter { Value = $"%{breed}%" }); }
        if (!string.IsNullOrEmpty(gender))  { where.Add($"p.gender = ${n++}");    parms.Add(new NpgsqlParameter { Value = gender }); }
        if (!string.IsNullOrEmpty(cityId) && int.TryParse(cityId, out var ci))
            { where.Add($"p.city_id = ${n++}"); parms.Add(new NpgsqlParameter { Value = ci }); }
        var ws = "WHERE " + string.Join(" AND ", where);
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT p.id, p.name, p.species, p.breed, p.colour, p.gender,
                   p.date_of_birth, p.photo_url, p.pet_id, p.breeding_opt_in, p.created_at,
                   u.name AS owner_name,
                   c.name AS city_name, w.ward_number
            FROM pets p
            LEFT JOIN users  u  ON u.id  = p.owner_id
            LEFT JOIN cities c  ON c.id  = p.city_id
            LEFT JOIN wards  w  ON w.id  = p.ward_id
            {ws}
            ORDER BY p.name LIMIT 50
            """;
        foreach (var pm in parms) cmd.Parameters.Add(pm);
        await using var rdr  = await cmd.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        foreach (var row in rows) row["owner_mobile"] = null;
        return Results.Json(rows);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapGet("/api/pets/adoption", async (HttpContext ctx) =>
{
    if (dbSource == null) return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        var cityId = ctx.Request.Query["cityId"].FirstOrDefault() ?? "";
        var where  = new List<string> { "p.registration_status = 'approved'" };
        var parms  = new List<NpgsqlParameter>();
        int n = 1;
        if (!string.IsNullOrEmpty(cityId) && int.TryParse(cityId, out var ci))
            { where.Add($"p.city_id = ${n++}"); parms.Add(new NpgsqlParameter { Value = ci }); }
        var ws = "WHERE " + string.Join(" AND ", where);
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT p.id, p.name, p.species, p.breed, p.colour, p.gender,
                   p.date_of_birth, p.photo_url, p.pet_id, p.created_at,
                   u.name AS owner_name,
                   c.name AS city_name, w.ward_number
            FROM pets p
            LEFT JOIN users  u  ON u.id  = p.owner_id
            LEFT JOIN cities c  ON c.id  = p.city_id
            LEFT JOIN wards  w  ON w.id  = p.ward_id
            {ws}
            ORDER BY p.created_at DESC LIMIT 20
            """;
        foreach (var pm in parms) cmd.Parameters.Add(pm);
        await using var rdr = await cmd.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        foreach (var row in rows) row["owner_mobile"] = null;
        return Results.Json(rows);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

// ?? Pets proxy ????????????????????????????????????????????????????????????????
app.MapGet("/api/pets/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var qs      = ctx.Request.QueryString.Value ?? "";
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var resp    = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/pets{segment}{qs}");
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            return Results.Content("[]", "application/json");
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
// ?? Upload proxy � raw stream passthrough (MUST be before generic POST catch-all) ??????????
// The generic POST proxy reads the body as UTF-8 text and re-wraps it as application/json,
// which destroys multipart/form-data boundaries. These specific routes stream raw bytes through.
app.MapPost("/api/pets/{id:int}/upload-photo", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var client  = MakeClient(f, ctx.Request);
        var content = new StreamContent(ctx.Request.Body);
        if (!string.IsNullOrEmpty(ctx.Request.ContentType))
            content.Headers.TryAddWithoutValidation("Content-Type", ctx.Request.ContentType);
        var resp = await client.PostAsync($"{backendBase}/api/pets/{id}/upload-photo", content);
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapPost("/api/pets/{id:int}/upload-certificate", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var client  = MakeClient(f, ctx.Request);
        var content = new StreamContent(ctx.Request.Body);
        if (!string.IsNullOrEmpty(ctx.Request.ContentType))
            content.Headers.TryAddWithoutValidation("Content-Type", ctx.Request.ContentType);
        var resp = await client.PostAsync($"{backendBase}/api/pets/{id}/upload-certificate", content);
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

app.MapPost("/api/pets/{**path}", async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var segment = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var json    = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var resp    = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/pets{segment}",
            new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapMethods("/api/pets/{**path}", new[] { "PATCH" }, async (string? path, HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var segment  = string.IsNullOrEmpty(path) ? "" : "/" + path;
        var json     = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        var patchReq = new HttpRequestMessage(new HttpMethod("PATCH"), $"{backendBase}/api/pets{segment}")
            { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };
        var resp = await MakeClient(f, ctx.Request).SendAsync(patchReq);
        return await SafeGet(resp);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Doctors proxy (public GET + admin write) ??????????????????????????????????
// GET /api/doctors  � used by citizen search screen (AFP.GET)
// doctors + shops -- direct PostgreSQL (no Node.js dependency)
app.MapGet("/api/doctors", async (HttpContext ctx) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        var cId=ctx.Request.Query["cityId"].FirstOrDefault()??""; var q=ctx.Request.Query["q"].FirstOrDefault()??"";
        var w=new List<string>{"d.is_active = TRUE"}; var p=new List<NpgsqlParameter>(); int n=1;
        if(!string.IsNullOrEmpty(cId)&&int.TryParse(cId,out var ci)){w.Add($"d.city_id=${n++}");p.Add(new NpgsqlParameter{Value=ci});}
        if(!string.IsNullOrEmpty(q)){w.Add($"(d.name ILIKE ${n} OR d.clinic_name ILIKE ${n} OR d.specialization ILIKE ${n})");n++;p.Add(new NpgsqlParameter{Value=$"%{q}%"});}
        var ws="WHERE "+string.Join(" AND ",w); await using var c=await dbSource.OpenConnectionAsync(); await using var cmd=c.CreateCommand();
        cmd.CommandText=$"SELECT d.*,ci.name AS city_name,ng.name AS nigam_name,z.name AS zone_name,ww.ward_number FROM doctors d LEFT JOIN cities ci ON ci.id=d.city_id LEFT JOIN nigams ng ON ng.id=d.nigam_id LEFT JOIN zones z ON z.id=d.zone_id LEFT JOIN wards ww ON ww.id=d.ward_id {ws} ORDER BY d.name LIMIT 100";
        foreach(var pm in p)cmd.Parameters.Add(pm); await using var rdr=await cmd.ExecuteReaderAsync(); return Results.Json(await ReadRows(rdr));
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});
app.MapGet("/api/admin/doctors", async (HttpContext ctx) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        var cId=ctx.Request.Query["cityId"].FirstOrDefault()??""; var ngId=ctx.Request.Query["nigamId"].FirstOrDefault()??"";
        var zId=ctx.Request.Query["zoneId"].FirstOrDefault()??""; var wId=ctx.Request.Query["wardId"].FirstOrDefault()??"";
        var q=ctx.Request.Query["q"].FirstOrDefault()??""; var w=new List<string>{"d.is_active = TRUE"}; var p=new List<NpgsqlParameter>(); int n=1;
        if(!string.IsNullOrEmpty(cId)&&int.TryParse(cId,out var ci)){w.Add($"d.city_id=${n++}");p.Add(new NpgsqlParameter{Value=ci});}
        if(!string.IsNullOrEmpty(ngId)&&int.TryParse(ngId,out var ni)){w.Add($"d.nigam_id=${n++}");p.Add(new NpgsqlParameter{Value=ni});}
        if(!string.IsNullOrEmpty(zId)&&int.TryParse(zId,out var zi)){w.Add($"d.zone_id=${n++}");p.Add(new NpgsqlParameter{Value=zi});}
        if(!string.IsNullOrEmpty(wId)&&int.TryParse(wId,out var wi)){w.Add($"d.ward_id=${n++}");p.Add(new NpgsqlParameter{Value=wi});}
        if(!string.IsNullOrEmpty(q)){w.Add($"(d.name ILIKE ${n} OR d.clinic_name ILIKE ${n} OR d.specialization ILIKE ${n})");n++;p.Add(new NpgsqlParameter{Value=$"%{q}%"});}
        var ws="WHERE "+string.Join(" AND ",w); await using var c=await dbSource.OpenConnectionAsync(); await using var cmd=c.CreateCommand();
        cmd.CommandText=$"SELECT d.*,ci.name AS city_name,ng.name AS nigam_name,z.name AS zone_name,ww.ward_number FROM doctors d LEFT JOIN cities ci ON ci.id=d.city_id LEFT JOIN nigams ng ON ng.id=d.nigam_id LEFT JOIN zones z ON z.id=d.zone_id LEFT JOIN wards ww ON ww.id=d.ward_id {ws} ORDER BY d.name LIMIT 200";
        foreach(var pm in p)cmd.Parameters.Add(pm); await using var rdr=await cmd.ExecuteReaderAsync(); return Results.Json(await ReadRows(rdr));
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});
app.MapPost("/api/admin/doctors", async (HttpContext ctx) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        var bs=await new StreamReader(ctx.Request.Body).ReadToEndAsync(); using var doc=JsonDocument.Parse(bs); var r=doc.RootElement;
        var nm=r.TryGetProperty("name",out var _n)?_n.GetString()?.Trim():null; var mob=r.TryGetProperty("mobile",out var _m)?_m.GetString()?.Trim():null;
        var ql=r.TryGetProperty("qualification",out var _q)?_q.GetString()?.Trim():null; var sp=r.TryGetProperty("specialization",out var _s)?_s.GetString()?.Trim():null;
        var cl=r.TryGetProperty("clinicName",out var _cl)?_cl.GetString()?.Trim():null; var ad=r.TryGetProperty("address",out var _a)?_a.GetString()?.Trim():null;
        var tm=r.TryGetProperty("timings",out var _t)?_t.GetString()?.Trim():null; bool i24=r.TryGetProperty("is24hr",out var _24)&&_24.ValueKind==JsonValueKind.True;
        int? ci=r.TryGetProperty("cityId",out var _ci)&&_ci.ValueKind==JsonValueKind.Number?_ci.GetInt32():(int?)null;
        int? ni=r.TryGetProperty("nigamId",out var _ni)&&_ni.ValueKind==JsonValueKind.Number?_ni.GetInt32():(int?)null;
        int? zi=r.TryGetProperty("zoneId",out var _zi)&&_zi.ValueKind==JsonValueKind.Number?_zi.GetInt32():(int?)null;
        int? wi=r.TryGetProperty("wardId",out var _wi)&&_wi.ValueKind==JsonValueKind.Number?_wi.GetInt32():(int?)null;
        if(string.IsNullOrWhiteSpace(nm)||string.IsNullOrWhiteSpace(mob))return Results.Json(new{error="name and mobile required."},statusCode:400);
        await using var con=await dbSource.OpenConnectionAsync(); await using var ins=con.CreateCommand();
        ins.CommandText="INSERT INTO doctors(name,qualification,specialization,clinic_name,address,mobile,timings,is_24hr,city_id,nigam_id,zone_id,ward_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)RETURNING id";
        ins.Parameters.Add(new NpgsqlParameter{Value=nm}); ins.Parameters.Add(new NpgsqlParameter{Value=(object?)ql??DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=(object?)sp??DBNull.Value});
        ins.Parameters.Add(new NpgsqlParameter{Value=(object?)cl??DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=(object?)ad??DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=mob});
        ins.Parameters.Add(new NpgsqlParameter{Value=(object?)tm??DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=i24});
        ins.Parameters.Add(new NpgsqlParameter{Value=ci.HasValue?(object)ci.Value:DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=ni.HasValue?(object)ni.Value:DBNull.Value});
        ins.Parameters.Add(new NpgsqlParameter{Value=zi.HasValue?(object)zi.Value:DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=wi.HasValue?(object)wi.Value:DBNull.Value});
        var nid=(int)(await ins.ExecuteScalarAsync())!; await ins.DisposeAsync();
        await using var sel=con.CreateCommand(); sel.CommandText="SELECT d.*,ci.name AS city_name,ng.name AS nigam_name,z.name AS zone_name,ww.ward_number FROM doctors d LEFT JOIN cities ci ON ci.id=d.city_id LEFT JOIN nigams ng ON ng.id=d.nigam_id LEFT JOIN zones z ON z.id=d.zone_id LEFT JOIN wards ww ON ww.id=d.ward_id WHERE d.id=$1";
        sel.Parameters.Add(new NpgsqlParameter{Value=nid}); await using var rdr=await sel.ExecuteReaderAsync(); var rows=await ReadRows(rdr);
        return Results.Json(rows.Count>0?(object)rows[0]:new{id=nid},statusCode:201);
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});
app.MapPut("/api/admin/doctors/{id:int}", async (int id, HttpContext ctx) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        var bs=await new StreamReader(ctx.Request.Body).ReadToEndAsync(); using var doc=JsonDocument.Parse(bs); var r=doc.RootElement;
        var nm=r.TryGetProperty("name",out var _n)?_n.GetString()?.Trim():null; var mob=r.TryGetProperty("mobile",out var _m)?_m.GetString()?.Trim():null;
        var ql=r.TryGetProperty("qualification",out var _q)?_q.GetString()?.Trim():null; var sp=r.TryGetProperty("specialization",out var _s)?_s.GetString()?.Trim():null;
        var cl=r.TryGetProperty("clinicName",out var _cl)?_cl.GetString()?.Trim():null; var ad=r.TryGetProperty("address",out var _a)?_a.GetString()?.Trim():null;
        var tm=r.TryGetProperty("timings",out var _t)?_t.GetString()?.Trim():null; bool i24=r.TryGetProperty("is24hr",out var _24)&&_24.ValueKind==JsonValueKind.True;
        int? ci=r.TryGetProperty("cityId",out var _ci)&&_ci.ValueKind==JsonValueKind.Number?_ci.GetInt32():(int?)null;
        int? ni=r.TryGetProperty("nigamId",out var _ni)&&_ni.ValueKind==JsonValueKind.Number?_ni.GetInt32():(int?)null;
        int? zi=r.TryGetProperty("zoneId",out var _zi)&&_zi.ValueKind==JsonValueKind.Number?_zi.GetInt32():(int?)null;
        int? wi=r.TryGetProperty("wardId",out var _wi)&&_wi.ValueKind==JsonValueKind.Number?_wi.GetInt32():(int?)null;
        await using var con=await dbSource.OpenConnectionAsync(); await using var upd=con.CreateCommand();
        upd.CommandText="UPDATE doctors SET name=COALESCE($1,name),qualification=COALESCE($2,qualification),specialization=COALESCE($3,specialization),clinic_name=COALESCE($4,clinic_name),address=COALESCE($5,address),mobile=COALESCE($6,mobile),timings=COALESCE($7,timings),is_24hr=$8,city_id=COALESCE($9,city_id),nigam_id=COALESCE($10,nigam_id),zone_id=COALESCE($11,zone_id),ward_id=COALESCE($12,ward_id),updated_at=NOW() WHERE id=$13 RETURNING id";
        upd.Parameters.Add(new NpgsqlParameter{Value=(object?)nm??DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=(object?)ql??DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=(object?)sp??DBNull.Value});
        upd.Parameters.Add(new NpgsqlParameter{Value=(object?)cl??DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=(object?)ad??DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=(object?)mob??DBNull.Value});
        upd.Parameters.Add(new NpgsqlParameter{Value=(object?)tm??DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=i24});
        upd.Parameters.Add(new NpgsqlParameter{Value=ci.HasValue?(object)ci.Value:DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=ni.HasValue?(object)ni.Value:DBNull.Value});
        upd.Parameters.Add(new NpgsqlParameter{Value=zi.HasValue?(object)zi.Value:DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=wi.HasValue?(object)wi.Value:DBNull.Value});
        upd.Parameters.Add(new NpgsqlParameter{Value=id}); var res=await upd.ExecuteScalarAsync();
        if(res==null||res is DBNull)return Results.Json(new{error="Doctor not found."},statusCode:404);
        return Results.Json(new{message="Doctor updated."});
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});
app.MapDelete("/api/admin/doctors/{id:int}", async (int id) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        await using var con=await dbSource.OpenConnectionAsync(); await using var del=con.CreateCommand();
        del.CommandText="DELETE FROM doctors WHERE id=$1 RETURNING id"; del.Parameters.Add(new NpgsqlParameter{Value=id});
        var res=await del.ExecuteScalarAsync(); if(res==null||res is DBNull)return Results.Json(new{error="Doctor not found."},statusCode:404);
        return Results.Json(new{message="Doctor deleted.",id});
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});
app.MapGet("/api/shops", async (HttpContext ctx) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        var cId=ctx.Request.Query["cityId"].FirstOrDefault()??""; var q=ctx.Request.Query["q"].FirstOrDefault()??"";
        var w=new List<string>{"s.is_active = TRUE"}; var p=new List<NpgsqlParameter>(); int n=1;
        if(!string.IsNullOrEmpty(cId)&&int.TryParse(cId,out var ci)){w.Add($"s.city_id=${n++}");p.Add(new NpgsqlParameter{Value=ci});}
        if(!string.IsNullOrEmpty(q)){w.Add($"(s.name ILIKE ${n} OR s.owner_name ILIKE ${n} OR s.speciality ILIKE ${n})");n++;p.Add(new NpgsqlParameter{Value=$"%{q}%"});}
        var ws="WHERE "+string.Join(" AND ",w); await using var c=await dbSource.OpenConnectionAsync(); await using var cmd=c.CreateCommand();
        cmd.CommandText=$"SELECT s.*,ci.name AS city_name,ng.name AS nigam_name,z.name AS zone_name,ww.ward_number FROM shops s LEFT JOIN cities ci ON ci.id=s.city_id LEFT JOIN nigams ng ON ng.id=s.nigam_id LEFT JOIN zones z ON z.id=s.zone_id LEFT JOIN wards ww ON ww.id=s.ward_id {ws} ORDER BY s.name LIMIT 100";
        foreach(var pm in p)cmd.Parameters.Add(pm); await using var rdr=await cmd.ExecuteReaderAsync(); return Results.Json(await ReadRows(rdr));
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});
app.MapGet("/api/admin/shops", async (HttpContext ctx) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        var cId=ctx.Request.Query["cityId"].FirstOrDefault()??""; var ngId=ctx.Request.Query["nigamId"].FirstOrDefault()??"";
        var zId=ctx.Request.Query["zoneId"].FirstOrDefault()??""; var wId=ctx.Request.Query["wardId"].FirstOrDefault()??"";
        var q=ctx.Request.Query["q"].FirstOrDefault()??""; var w=new List<string>{"s.is_active = TRUE"}; var p=new List<NpgsqlParameter>(); int n=1;
        if(!string.IsNullOrEmpty(cId)&&int.TryParse(cId,out var ci)){w.Add($"s.city_id=${n++}");p.Add(new NpgsqlParameter{Value=ci});}
        if(!string.IsNullOrEmpty(ngId)&&int.TryParse(ngId,out var ni)){w.Add($"s.nigam_id=${n++}");p.Add(new NpgsqlParameter{Value=ni});}
        if(!string.IsNullOrEmpty(zId)&&int.TryParse(zId,out var zi)){w.Add($"s.zone_id=${n++}");p.Add(new NpgsqlParameter{Value=zi});}
        if(!string.IsNullOrEmpty(wId)&&int.TryParse(wId,out var wi)){w.Add($"s.ward_id=${n++}");p.Add(new NpgsqlParameter{Value=wi});}
        if(!string.IsNullOrEmpty(q)){w.Add($"(s.name ILIKE ${n} OR s.owner_name ILIKE ${n} OR s.speciality ILIKE ${n})");n++;p.Add(new NpgsqlParameter{Value=$"%{q}%"});}
        var ws="WHERE "+string.Join(" AND ",w); await using var c=await dbSource.OpenConnectionAsync(); await using var cmd=c.CreateCommand();
        cmd.CommandText=$"SELECT s.*,ci.name AS city_name,ng.name AS nigam_name,z.name AS zone_name,ww.ward_number FROM shops s LEFT JOIN cities ci ON ci.id=s.city_id LEFT JOIN nigams ng ON ng.id=s.nigam_id LEFT JOIN zones z ON z.id=s.zone_id LEFT JOIN wards ww ON ww.id=s.ward_id {ws} ORDER BY s.name LIMIT 200";
        foreach(var pm in p)cmd.Parameters.Add(pm); await using var rdr=await cmd.ExecuteReaderAsync(); return Results.Json(await ReadRows(rdr));
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});
app.MapPost("/api/admin/shops", async (HttpContext ctx) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        var bs=await new StreamReader(ctx.Request.Body).ReadToEndAsync(); using var doc=JsonDocument.Parse(bs); var r=doc.RootElement;
        var nm=r.TryGetProperty("name",out var _n)?_n.GetString()?.Trim():null; var ow=r.TryGetProperty("ownerName",out var _o)?_o.GetString()?.Trim():null;
        var mob=r.TryGetProperty("mobile",out var _m)?_m.GetString()?.Trim():null; var ad=r.TryGetProperty("address",out var _a)?_a.GetString()?.Trim():null;
        var tm=r.TryGetProperty("timings",out var _t)?_t.GetString()?.Trim():null; var sp=r.TryGetProperty("speciality",out var _sp)?_sp.GetString()?.Trim():null;
        int? ci=r.TryGetProperty("cityId",out var _ci)&&_ci.ValueKind==JsonValueKind.Number?_ci.GetInt32():(int?)null;
        int? ni=r.TryGetProperty("nigamId",out var _ni)&&_ni.ValueKind==JsonValueKind.Number?_ni.GetInt32():(int?)null;
        int? zi=r.TryGetProperty("zoneId",out var _zi)&&_zi.ValueKind==JsonValueKind.Number?_zi.GetInt32():(int?)null;
        int? wi=r.TryGetProperty("wardId",out var _wi)&&_wi.ValueKind==JsonValueKind.Number?_wi.GetInt32():(int?)null;
        if(string.IsNullOrWhiteSpace(nm))return Results.Json(new{error="name is required."},statusCode:400);
        await using var con=await dbSource.OpenConnectionAsync(); await using var ins=con.CreateCommand();
        ins.CommandText="INSERT INTO shops(name,owner_name,address,mobile,timings,speciality,city_id,nigam_id,zone_id,ward_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)RETURNING id";
        ins.Parameters.Add(new NpgsqlParameter{Value=nm}); ins.Parameters.Add(new NpgsqlParameter{Value=(object?)ow??DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=(object?)ad??DBNull.Value});
        ins.Parameters.Add(new NpgsqlParameter{Value=(object?)mob??DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=(object?)tm??DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=(object?)sp??DBNull.Value});
        ins.Parameters.Add(new NpgsqlParameter{Value=ci.HasValue?(object)ci.Value:DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=ni.HasValue?(object)ni.Value:DBNull.Value});
        ins.Parameters.Add(new NpgsqlParameter{Value=zi.HasValue?(object)zi.Value:DBNull.Value}); ins.Parameters.Add(new NpgsqlParameter{Value=wi.HasValue?(object)wi.Value:DBNull.Value});
        var nid=(int)(await ins.ExecuteScalarAsync())!; await ins.DisposeAsync();
        await using var sel=con.CreateCommand(); sel.CommandText="SELECT s.*,ci.name AS city_name,ng.name AS nigam_name,z.name AS zone_name,ww.ward_number FROM shops s LEFT JOIN cities ci ON ci.id=s.city_id LEFT JOIN nigams ng ON ng.id=s.nigam_id LEFT JOIN zones z ON z.id=s.zone_id LEFT JOIN wards ww ON ww.id=s.ward_id WHERE s.id=$1";
        sel.Parameters.Add(new NpgsqlParameter{Value=nid}); await using var rdr=await sel.ExecuteReaderAsync(); var rows=await ReadRows(rdr);
        return Results.Json(rows.Count>0?(object)rows[0]:new{id=nid},statusCode:201);
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});
app.MapPut("/api/admin/shops/{id:int}", async (int id, HttpContext ctx) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        var bs=await new StreamReader(ctx.Request.Body).ReadToEndAsync(); using var doc=JsonDocument.Parse(bs); var r=doc.RootElement;
        var nm=r.TryGetProperty("name",out var _n)?_n.GetString()?.Trim():null; var ow=r.TryGetProperty("ownerName",out var _o)?_o.GetString()?.Trim():null;
        var mob=r.TryGetProperty("mobile",out var _m)?_m.GetString()?.Trim():null; var ad=r.TryGetProperty("address",out var _a)?_a.GetString()?.Trim():null;
        var tm=r.TryGetProperty("timings",out var _t)?_t.GetString()?.Trim():null; var sp=r.TryGetProperty("speciality",out var _sp)?_sp.GetString()?.Trim():null;
        int? ci=r.TryGetProperty("cityId",out var _ci)&&_ci.ValueKind==JsonValueKind.Number?_ci.GetInt32():(int?)null;
        int? ni=r.TryGetProperty("nigamId",out var _ni)&&_ni.ValueKind==JsonValueKind.Number?_ni.GetInt32():(int?)null;
        int? zi=r.TryGetProperty("zoneId",out var _zi)&&_zi.ValueKind==JsonValueKind.Number?_zi.GetInt32():(int?)null;
        int? wi=r.TryGetProperty("wardId",out var _wi)&&_wi.ValueKind==JsonValueKind.Number?_wi.GetInt32():(int?)null;
        await using var con=await dbSource.OpenConnectionAsync(); await using var upd=con.CreateCommand();
        upd.CommandText="UPDATE shops SET name=COALESCE($1,name),owner_name=COALESCE($2,owner_name),address=COALESCE($3,address),mobile=COALESCE($4,mobile),timings=COALESCE($5,timings),speciality=COALESCE($6,speciality),city_id=COALESCE($7,city_id),nigam_id=COALESCE($8,nigam_id),zone_id=COALESCE($9,zone_id),ward_id=COALESCE($10,ward_id),updated_at=NOW() WHERE id=$11 RETURNING id";
        upd.Parameters.Add(new NpgsqlParameter{Value=(object?)nm??DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=(object?)ow??DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=(object?)ad??DBNull.Value});
        upd.Parameters.Add(new NpgsqlParameter{Value=(object?)mob??DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=(object?)tm??DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=(object?)sp??DBNull.Value});
        upd.Parameters.Add(new NpgsqlParameter{Value=ci.HasValue?(object)ci.Value:DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=ni.HasValue?(object)ni.Value:DBNull.Value});
        upd.Parameters.Add(new NpgsqlParameter{Value=zi.HasValue?(object)zi.Value:DBNull.Value}); upd.Parameters.Add(new NpgsqlParameter{Value=wi.HasValue?(object)wi.Value:DBNull.Value});
        upd.Parameters.Add(new NpgsqlParameter{Value=id}); var res=await upd.ExecuteScalarAsync();
        if(res==null||res is DBNull)return Results.Json(new{error="Shop not found."},statusCode:404);
        return Results.Json(new{message="Shop updated."});
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});
app.MapDelete("/api/admin/shops/{id:int}", async (int id) => {
    if (dbSource==null) return Results.Json(new{error="Database not configured."},statusCode:503);
    try {
        await using var con=await dbSource.OpenConnectionAsync(); await using var del=con.CreateCommand();
        del.CommandText="DELETE FROM shops WHERE id=$1 RETURNING id"; del.Parameters.Add(new NpgsqlParameter{Value=id});
        var res=await del.ExecuteScalarAsync(); if(res==null||res is DBNull)return Results.Json(new{error="Shop not found."},statusCode:404);
        return Results.Json(new{message="Shop deleted.",id});
    } catch(Exception ex){return Results.Json(new{error=ex.Message},statusCode:500);}
});

// ?? Admin stats + pets proxy ??????????????????????????????????????????????????
app.MapGet("/api/admin/stats", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/admin/stats");
        return await SafeGet(resp, "{}");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});
app.MapGet("/api/admin/pets", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var resp = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/admin/pets");
        return await SafeGet(resp, "[]");
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502);
    }
});

// ?? User Management - direct PostgreSQL (Node backend has no user-management routes) ??
// GET  /api/admin/users          - list users filtered by role / geo / search
// POST /api/admin/users          - create user (password hashed via pgcrypto crypt())
// PUT  /api/admin/users/{id}     - update user (password optional)
// DELETE /api/admin/users/{id}   - delete user

app.MapGet("/api/admin/users", async (HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        var role    = ctx.Request.Query["role"].FirstOrDefault()    ?? "";
        var cityId  = ctx.Request.Query["cityId"].FirstOrDefault()  ?? "";
        var nigamId = ctx.Request.Query["nigamId"].FirstOrDefault() ?? "";
        var zoneId  = ctx.Request.Query["zoneId"].FirstOrDefault()  ?? "";
        var wardId  = ctx.Request.Query["wardId"].FirstOrDefault()  ?? "";
        var q       = ctx.Request.Query["q"].FirstOrDefault()       ?? "";

        var where = new List<string>();
        var parms = new List<NpgsqlParameter>();
        int n     = 1;

        if (!string.IsNullOrEmpty(role))
            { where.Add($"u.role = ${n++}"); parms.Add(new NpgsqlParameter { Value = role }); }
        if (!string.IsNullOrEmpty(cityId)  && int.TryParse(cityId,  out var ci))
            { where.Add($"u.city_id = ${n++}");  parms.Add(new NpgsqlParameter { Value = ci }); }
        if (!string.IsNullOrEmpty(nigamId) && int.TryParse(nigamId, out var ni))
            { where.Add($"u.nigam_id = ${n++}"); parms.Add(new NpgsqlParameter { Value = ni }); }
        if (!string.IsNullOrEmpty(zoneId)  && int.TryParse(zoneId,  out var zi))
            { where.Add($"u.zone_id = ${n++}");  parms.Add(new NpgsqlParameter { Value = zi }); }
        if (!string.IsNullOrEmpty(wardId)  && int.TryParse(wardId,  out var wi))
            { where.Add($"u.ward_id = ${n++}");  parms.Add(new NpgsqlParameter { Value = wi }); }
        if (!string.IsNullOrEmpty(q))
        {
            where.Add($"(u.name ILIKE ${n} OR u.mobile ILIKE ${n} OR u.email ILIKE ${n})");
            n++;
            parms.Add(new NpgsqlParameter { Value = $"%{q}%" });
        }

        var ws = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";

        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT u.id, u.name, u.mobile, u.email, u.address, u.role,
                   u.city_id, u.nigam_id, u.zone_id, u.ward_id,
                   u.is_active, u.created_at, u.updated_at,
                   c.name  AS city_name,
                   ng.name AS nigam_name,
                   z.name  AS zone_name,
                   w.ward_number
            FROM users u
            LEFT JOIN cities c  ON c.id  = u.city_id
            LEFT JOIN nigams ng ON ng.id = u.nigam_id
            LEFT JOIN zones  z  ON z.id  = u.zone_id
            LEFT JOIN wards  w  ON w.id  = u.ward_id
            {ws}
            ORDER BY u.created_at DESC
            LIMIT 200
            """;
        foreach (var pm in parms) cmd.Parameters.Add(pm);
        await using var rdr = await cmd.ExecuteReaderAsync();
        return Results.Json(await ReadRows(rdr));
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPost("/api/admin/users", async (HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        var bodyStr   = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var root      = doc.RootElement;

        var name     = root.TryGetProperty("name",     out var _n)  ? _n.GetString()?.Trim()  : null;
        var mobile   = root.TryGetProperty("mobile",   out var _m)  ? _m.GetString()?.Trim()  : null;
        var email    = root.TryGetProperty("email",    out var _e)  ? _e.GetString()?.Trim()  : null;
        var address  = root.TryGetProperty("address",  out var _a)  ? _a.GetString()?.Trim()  : null;
        var role     = root.TryGetProperty("role",     out var _r)  ? _r.GetString()          : "citizen";
        var password = root.TryGetProperty("password", out var _pw) ? _pw.GetString()         : null;
        bool isActive = !root.TryGetProperty("is_active", out var _ia) || _ia.ValueKind != JsonValueKind.False;

        int? cityId  = root.TryGetProperty("cityId",  out var _ci) && _ci.ValueKind == JsonValueKind.Number ? _ci.GetInt32() : (int?)null;
        int? nigamId = root.TryGetProperty("nigamId", out var _ni) && _ni.ValueKind == JsonValueKind.Number ? _ni.GetInt32() : (int?)null;
        int? zoneId  = root.TryGetProperty("zoneId",  out var _zi) && _zi.ValueKind == JsonValueKind.Number ? _zi.GetInt32() : (int?)null;
        int? wardId  = root.TryGetProperty("wardId",  out var _wi) && _wi.ValueKind == JsonValueKind.Number ? _wi.GetInt32() : (int?)null;

        if (string.IsNullOrWhiteSpace(name))     return Results.Json(new { error = "Name is required."     }, statusCode: 400);
        if (string.IsNullOrWhiteSpace(mobile))   return Results.Json(new { error = "Mobile is required."   }, statusCode: 400);
        if (string.IsNullOrWhiteSpace(password)) return Results.Json(new { error = "Password is required." }, statusCode: 400);

        await using var conn = await dbSource.OpenConnectionAsync();

        // Check mobile uniqueness
        await using var chk = conn.CreateCommand();
        chk.CommandText = "SELECT id FROM users WHERE mobile = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = mobile });
        if (await chk.ExecuteScalarAsync() != null)
            return Results.Json(new { error = "A user with this mobile number already exists." }, statusCode: 409);
        await chk.DisposeAsync();

        await using var ins = conn.CreateCommand();
        ins.CommandText = """
            INSERT INTO users
              (name, mobile, email, address, role, password_hash,
               city_id, nigam_id, zone_id, ward_id, is_active)
            VALUES
              ($1, $2, $3, $4, $5, crypt($6, gen_salt('bf', 10)),
               $7, $8, $9, $10, $11)
            RETURNING id
            """;
        ins.Parameters.Add(new NpgsqlParameter { Value = name });
        ins.Parameters.Add(new NpgsqlParameter { Value = mobile });
        ins.Parameters.Add(new NpgsqlParameter { Value = string.IsNullOrEmpty(email)   ? (object)DBNull.Value : email });
        ins.Parameters.Add(new NpgsqlParameter { Value = string.IsNullOrEmpty(address) ? (object)DBNull.Value : address });
        ins.Parameters.Add(new NpgsqlParameter { Value = role ?? "citizen" });
        ins.Parameters.Add(new NpgsqlParameter { Value = password });
        ins.Parameters.Add(new NpgsqlParameter { Value = cityId.HasValue  ? (object)cityId.Value  : DBNull.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = nigamId.HasValue ? (object)nigamId.Value : DBNull.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = zoneId.HasValue  ? (object)zoneId.Value  : DBNull.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = wardId.HasValue  ? (object)wardId.Value  : DBNull.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = isActive });

        var newId = (int)(await ins.ExecuteScalarAsync())!;
        await ins.DisposeAsync();

        await using var sel = conn.CreateCommand();
        sel.CommandText = """
            SELECT u.id, u.name, u.mobile, u.email, u.address, u.role,
                   u.city_id, u.nigam_id, u.zone_id, u.ward_id,
                   u.is_active, u.created_at,
                   c.name  AS city_name,
                   ng.name AS nigam_name,
                   z.name  AS zone_name,
                   w.ward_number
            FROM users u
            LEFT JOIN cities c  ON c.id  = u.city_id
            LEFT JOIN nigams ng ON ng.id = u.nigam_id
            LEFT JOIN zones  z  ON z.id  = u.zone_id
            LEFT JOIN wards  w  ON w.id  = u.ward_id
            WHERE u.id = $1
            """;
        sel.Parameters.Add(new NpgsqlParameter { Value = newId });
        await using var rdr = await sel.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        return Results.Json(rows.Count > 0 ? (object)rows[0] : new { id = newId }, statusCode: 201);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPut("/api/admin/users/{id:int}", async (int id, HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        var bodyStr   = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var root      = doc.RootElement;

        var name     = root.TryGetProperty("name",     out var _n)  ? _n.GetString()?.Trim()  : null;
        var mobile   = root.TryGetProperty("mobile",   out var _m)  ? _m.GetString()?.Trim()  : null;
        var email    = root.TryGetProperty("email",    out var _e)  ? _e.GetString()?.Trim()  : null;
        var address  = root.TryGetProperty("address",  out var _a)  ? _a.GetString()?.Trim()  : null;
        var role     = root.TryGetProperty("role",     out var _r)  ? _r.GetString()          : null;
        var password = root.TryGetProperty("password", out var _pw) ? _pw.GetString()         : null;
        bool isActive = !root.TryGetProperty("is_active", out var _ia) || _ia.ValueKind != JsonValueKind.False;

        int? cityId  = root.TryGetProperty("cityId",  out var _ci) && _ci.ValueKind == JsonValueKind.Number ? _ci.GetInt32() : (int?)null;
        int? nigamId = root.TryGetProperty("nigamId", out var _ni) && _ni.ValueKind == JsonValueKind.Number ? _ni.GetInt32() : (int?)null;
        int? zoneId  = root.TryGetProperty("zoneId",  out var _zi) && _zi.ValueKind == JsonValueKind.Number ? _zi.GetInt32() : (int?)null;
        int? wardId  = root.TryGetProperty("wardId",  out var _wi) && _wi.ValueKind == JsonValueKind.Number ? _wi.GetInt32() : (int?)null;

        if (string.IsNullOrWhiteSpace(name))   return Results.Json(new { error = "Name is required."   }, statusCode: 400);
        if (string.IsNullOrWhiteSpace(mobile)) return Results.Json(new { error = "Mobile is required." }, statusCode: 400);

        await using var conn = await dbSource.OpenConnectionAsync();

        await using var chk = conn.CreateCommand();
        chk.CommandText = "SELECT id FROM users WHERE id = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        if (await chk.ExecuteScalarAsync() == null)
            return Results.Json(new { error = "User not found." }, statusCode: 404);
        await chk.DisposeAsync();

        // Check mobile uniqueness (exclude self)
        await using var chk2 = conn.CreateCommand();
        chk2.CommandText = "SELECT id FROM users WHERE mobile = $1 AND id <> $2";
        chk2.Parameters.Add(new NpgsqlParameter { Value = mobile });
        chk2.Parameters.Add(new NpgsqlParameter { Value = id });
        if (await chk2.ExecuteScalarAsync() != null)
            return Results.Json(new { error = "Another user with this mobile number already exists." }, statusCode: 409);
        await chk2.DisposeAsync();

        await using var upd = conn.CreateCommand();
        var updatingPassword = !string.IsNullOrWhiteSpace(password);

        if (updatingPassword)
        {
            upd.CommandText = """
                UPDATE users SET
                    name = $1, mobile = $2, email = $3, address = $4, role = $5,
                    password_hash = crypt($6, gen_salt('bf', 10)),
                    city_id = $7, nigam_id = $8, zone_id = $9, ward_id = $10,
                    is_active = $11, updated_at = NOW()
                WHERE id = $12
                """;
            upd.Parameters.Add(new NpgsqlParameter { Value = name });
            upd.Parameters.Add(new NpgsqlParameter { Value = mobile });
            upd.Parameters.Add(new NpgsqlParameter { Value = string.IsNullOrEmpty(email)   ? (object)DBNull.Value : email });
            upd.Parameters.Add(new NpgsqlParameter { Value = string.IsNullOrEmpty(address) ? (object)DBNull.Value : address });
            upd.Parameters.Add(new NpgsqlParameter { Value = role ?? "citizen" });
            upd.Parameters.Add(new NpgsqlParameter { Value = password });
            upd.Parameters.Add(new NpgsqlParameter { Value = cityId.HasValue  ? (object)cityId.Value  : DBNull.Value });
            upd.Parameters.Add(new NpgsqlParameter { Value = nigamId.HasValue ? (object)nigamId.Value : DBNull.Value });
            upd.Parameters.Add(new NpgsqlParameter { Value = zoneId.HasValue  ? (object)zoneId.Value  : DBNull.Value });
            upd.Parameters.Add(new NpgsqlParameter { Value = wardId.HasValue  ? (object)wardId.Value  : DBNull.Value });
            upd.Parameters.Add(new NpgsqlParameter { Value = isActive });
            upd.Parameters.Add(new NpgsqlParameter { Value = id });
        }
        else
        {
            upd.CommandText = """
                UPDATE users SET
                    name = $1, mobile = $2, email = $3, address = $4, role = $5,
                    city_id = $6, nigam_id = $7, zone_id = $8, ward_id = $9,
                    is_active = $10, updated_at = NOW()
                WHERE id = $11
                """;
            upd.Parameters.Add(new NpgsqlParameter { Value = name });
            upd.Parameters.Add(new NpgsqlParameter { Value = mobile });
            upd.Parameters.Add(new NpgsqlParameter { Value = string.IsNullOrEmpty(email)   ? (object)DBNull.Value : email });
            upd.Parameters.Add(new NpgsqlParameter { Value = string.IsNullOrEmpty(address) ? (object)DBNull.Value : address });
            upd.Parameters.Add(new NpgsqlParameter { Value = role ?? "citizen" });
            upd.Parameters.Add(new NpgsqlParameter { Value = cityId.HasValue  ? (object)cityId.Value  : DBNull.Value });
            upd.Parameters.Add(new NpgsqlParameter { Value = nigamId.HasValue ? (object)nigamId.Value : DBNull.Value });
            upd.Parameters.Add(new NpgsqlParameter { Value = zoneId.HasValue  ? (object)zoneId.Value  : DBNull.Value });
            upd.Parameters.Add(new NpgsqlParameter { Value = wardId.HasValue  ? (object)wardId.Value  : DBNull.Value });
            upd.Parameters.Add(new NpgsqlParameter { Value = isActive });
            upd.Parameters.Add(new NpgsqlParameter { Value = id });
        }
        await upd.ExecuteNonQueryAsync();
        return Results.Json(new { message = "User updated." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapDelete("/api/admin/users/{id:int}", async (int id, HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        var reqUid = GetUserId(ctx.Request);
        if (reqUid == id)
            return Results.Json(new { error = "You cannot delete your own account." }, statusCode: 400);

        await using var conn = await dbSource.OpenConnectionAsync();
        await using var del  = conn.CreateCommand();
        del.CommandText = "DELETE FROM users WHERE id = $1 RETURNING id";
        del.Parameters.Add(new NpgsqlParameter { Value = id });
        var deleted = await del.ExecuteScalarAsync();
        if (deleted == null || deleted is DBNull)
            return Results.Json(new { error = "User not found." }, statusCode: 404);
        return Results.Json(new { message = "User deleted." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

// ?? Reports - direct PostgreSQL (Node backend has no reports routes) ????????
// GET  /api/reports                          - list reports scoped to caller's geo role
// POST /api/reports                          - citizen submits a new report
// PATCH /api/reports/{id}/resolve            - mark report resolved
// GET  /api/reports/{id}/comments            - list comments
// POST /api/reports/{id}/comments            - add comment
// PUT  /api/reports/{id}/comments/{cid}      - edit own comment

app.MapGet("/api/reports", async (HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        var uid = GetUserId(ctx.Request);

        // Resolve caller's role + geo scope from DB
        string? callerRole = null;
        int? callerCityId = null, callerNigamId = null, callerZoneId = null, callerWardId = null;
        if (uid != null)
        {
            await using var conn0 = await dbSource.OpenConnectionAsync();
            await using var cmd0  = conn0.CreateCommand();
            cmd0.CommandText = "SELECT role, city_id, nigam_id, zone_id, ward_id FROM users WHERE id = $1";
            cmd0.Parameters.Add(new NpgsqlParameter { Value = uid.Value });
            await using var r0 = await cmd0.ExecuteReaderAsync();
            if (await r0.ReadAsync())
            {
                callerRole    = r0.IsDBNull(0) ? null : r0.GetString(0);
                callerCityId  = r0.IsDBNull(1) ? (int?)null : r0.GetInt32(1);
                callerNigamId = r0.IsDBNull(2) ? (int?)null : r0.GetInt32(2);
                callerZoneId  = r0.IsDBNull(3) ? (int?)null : r0.GetInt32(3);
                callerWardId  = r0.IsDBNull(4) ? (int?)null : r0.GetInt32(4);
            }
        }

        var where = new List<string>();
        var parms = new List<NpgsqlParameter>();
        int n = 1;

        if (callerRole == "ward_admin" && callerWardId.HasValue)
            { where.Add($"r.ward_id = ${n++}");  parms.Add(new NpgsqlParameter { Value = callerWardId.Value }); }
        else if (callerRole == "zone_admin" && callerZoneId.HasValue)
            { where.Add($"r.zone_id = ${n++}");  parms.Add(new NpgsqlParameter { Value = callerZoneId.Value }); }
        else if (callerRole == "nigam_admin" && callerNigamId.HasValue)
            { where.Add($"r.nigam_id = ${n++}"); parms.Add(new NpgsqlParameter { Value = callerNigamId.Value }); }
        else if (callerRole == "city_admin" && callerCityId.HasValue)
            { where.Add($"r.city_id = ${n++}");  parms.Add(new NpgsqlParameter { Value = callerCityId.Value }); }
        // super_admin: no filter — sees everything

        var ws = where.Count > 0 ? "WHERE " + string.Join(" AND ", where) : "";

        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT r.*,
                   u.name  AS reporter_name,
                   c.name  AS city_name,
                   ng.name AS nigam_name,
                   z.name  AS zone_name,
                   w.ward_number
            FROM reports r
            LEFT JOIN users  u  ON u.id  = r.reporter_id
            LEFT JOIN cities c  ON c.id  = r.city_id
            LEFT JOIN nigams ng ON ng.id = r.nigam_id
            LEFT JOIN zones  z  ON z.id  = r.zone_id
            LEFT JOIN wards  w  ON w.id  = r.ward_id
            {ws}
            ORDER BY r.created_at DESC
            LIMIT 500
            """;
        foreach (var pm in parms) cmd.Parameters.Add(pm);
        await using var rdr = await cmd.ExecuteReaderAsync();
        return Results.Json(await ReadRows(rdr));
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPost("/api/reports", async (HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    var uid = GetUserId(ctx.Request);
    if (uid == null)
        return Results.Json(new { error = "Authentication required." }, statusCode: 401);
    try
    {
        var bodyStr   = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var root      = doc.RootElement;

        var reportType      = root.TryGetProperty("reportType",      out var _rt) ? _rt.GetString() : null;
        var lastSeenAddress = root.TryGetProperty("lastSeenAddress", out var _la) ? _la.GetString() : null;
        var reporterMobile  = root.TryGetProperty("reporterMobile",  out var _rm) ? _rm.GetString() : null;

        if (string.IsNullOrWhiteSpace(reportType))
            return Results.Json(new { error = "reportType is required." }, statusCode: 400);

        // Inherit geo from reporter's user record
        int? cityId = null, nigamId = null, zoneId = null, wardId = null;
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT city_id, nigam_id, zone_id, ward_id FROM users WHERE id = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = uid.Value });
        await using var r0 = await chk.ExecuteReaderAsync();
        if (await r0.ReadAsync())
        {
            cityId  = r0.IsDBNull(0) ? (int?)null : r0.GetInt32(0);
            nigamId = r0.IsDBNull(1) ? (int?)null : r0.GetInt32(1);
            zoneId  = r0.IsDBNull(2) ? (int?)null : r0.GetInt32(2);
            wardId  = r0.IsDBNull(3) ? (int?)null : r0.GetInt32(3);
        }
        await r0.DisposeAsync();
        await chk.DisposeAsync();

        await using var ins = conn.CreateCommand();
        ins.CommandText = """
            INSERT INTO reports
              (reporter_id, reporter_mobile, report_type, last_seen_address,
               city_id, nigam_id, zone_id, ward_id, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
            RETURNING id
            """;
        ins.Parameters.Add(new NpgsqlParameter { Value = uid.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = string.IsNullOrEmpty(reporterMobile)  ? (object)DBNull.Value : reporterMobile });
        ins.Parameters.Add(new NpgsqlParameter { Value = reportType });
        ins.Parameters.Add(new NpgsqlParameter { Value = string.IsNullOrEmpty(lastSeenAddress) ? (object)DBNull.Value : lastSeenAddress });
        ins.Parameters.Add(new NpgsqlParameter { Value = cityId.HasValue  ? (object)cityId.Value  : DBNull.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = nigamId.HasValue ? (object)nigamId.Value : DBNull.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = zoneId.HasValue  ? (object)zoneId.Value  : DBNull.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = wardId.HasValue  ? (object)wardId.Value  : DBNull.Value });
        var newId = (int)(await ins.ExecuteScalarAsync())!;
        return Results.Json(new { id = newId, message = "Report submitted." }, statusCode: 201);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapMethods("/api/reports/{id:int}/resolve", new[] { "PATCH" }, async (int id, HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    var uid = GetUserId(ctx.Request);
    if (uid == null)
        return Results.Json(new { error = "Authentication required." }, statusCode: 401);
    try
    {
        var bodyStr   = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var note = doc.RootElement.TryGetProperty("note", out var _n) ? _n.GetString() : null;

        await using var conn = await dbSource.OpenConnectionAsync();
        await using var upd  = conn.CreateCommand();
        upd.CommandText = """
            UPDATE reports
            SET status          = 'resolved',
                resolution_note = $1,
                resolved_at     = NOW(),
                resolved_by     = $2
            WHERE id = $3
            RETURNING id
            """;
        upd.Parameters.Add(new NpgsqlParameter { Value = string.IsNullOrEmpty(note) ? (object)DBNull.Value : note });
        upd.Parameters.Add(new NpgsqlParameter { Value = uid.Value });
        upd.Parameters.Add(new NpgsqlParameter { Value = id });
        var result = await upd.ExecuteScalarAsync();
        if (result == null || result is DBNull)
            return Results.Json(new { error = "Report not found." }, statusCode: 404);
        return Results.Json(new { message = "Report resolved." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

// Report comments ─────────────────────────────────────────────────────────────

app.MapGet("/api/reports/{id:int}/comments", async (int id) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = """
            SELECT rc.id, rc.report_id, rc.comment, rc.created_at, rc.updated_at,
                   u.name AS admin_name, u.role AS admin_role
            FROM report_comments rc
            LEFT JOIN users u ON u.id = rc.admin_id
            WHERE rc.report_id = $1
            ORDER BY rc.created_at ASC
            """;
        cmd.Parameters.Add(new NpgsqlParameter { Value = id });
        await using var rdr = await cmd.ExecuteReaderAsync();
        return Results.Json(await ReadRows(rdr));
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPost("/api/reports/{id:int}/comments", async (int id, HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    var uid = GetUserId(ctx.Request);
    if (uid == null)
        return Results.Json(new { error = "Authentication required." }, statusCode: 401);
    try
    {
        var bodyStr   = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var comment   = doc.RootElement.TryGetProperty("comment", out var _c) ? _c.GetString()?.Trim() : null;

        if (string.IsNullOrWhiteSpace(comment))
            return Results.Json(new { error = "Comment is required." }, statusCode: 400);

        await using var conn = await dbSource.OpenConnectionAsync();

        await using var chk = conn.CreateCommand();
        chk.CommandText = "SELECT id FROM reports WHERE id = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        if (await chk.ExecuteScalarAsync() == null)
            return Results.Json(new { error = "Report not found." }, statusCode: 404);
        await chk.DisposeAsync();

        await using var ins = conn.CreateCommand();
        ins.CommandText = "INSERT INTO report_comments (report_id, admin_id, comment) VALUES ($1,$2,$3) RETURNING id";
        ins.Parameters.Add(new NpgsqlParameter { Value = id });
        ins.Parameters.Add(new NpgsqlParameter { Value = uid.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = comment });
        var newId = (int)(await ins.ExecuteScalarAsync())!;
        await ins.DisposeAsync();

        await using var sel = conn.CreateCommand();
        sel.CommandText = """
            SELECT rc.id, rc.report_id, rc.comment, rc.created_at, rc.updated_at,
                   u.name AS admin_name, u.role AS admin_role
            FROM report_comments rc
            LEFT JOIN users u ON u.id = rc.admin_id
            WHERE rc.id = $1
            """;
        sel.Parameters.Add(new NpgsqlParameter { Value = newId });
        await using var rdr = await sel.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        return Results.Json(rows.Count > 0 ? (object)rows[0] : new { id = newId }, statusCode: 201);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPut("/api/reports/{id:int}/comments/{cid:int}", async (int id, int cid, HttpContext ctx) =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    var uid = GetUserId(ctx.Request);
    if (uid == null)
        return Results.Json(new { error = "Authentication required." }, statusCode: 401);
    try
    {
        var bodyStr   = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var comment   = doc.RootElement.TryGetProperty("comment", out var _c) ? _c.GetString()?.Trim() : null;

        if (string.IsNullOrWhiteSpace(comment))
            return Results.Json(new { error = "Comment is required." }, statusCode: 400);

        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT admin_id FROM report_comments WHERE id = $1 AND report_id = $2";
        chk.Parameters.Add(new NpgsqlParameter { Value = cid });
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        var ownerId = await chk.ExecuteScalarAsync();
        if (ownerId == null || ownerId is DBNull)
            return Results.Json(new { error = "Comment not found." }, statusCode: 404);
        if ((int)ownerId != uid.Value)
            return Results.Json(new { error = "You can only edit your own comments." }, statusCode: 403);
        await chk.DisposeAsync();

        await using var upd = conn.CreateCommand();
        upd.CommandText = "UPDATE report_comments SET comment = $1, updated_at = NOW() WHERE id = $2";
        upd.Parameters.Add(new NpgsqlParameter { Value = comment });
        upd.Parameters.Add(new NpgsqlParameter { Value = cid });
        await upd.ExecuteNonQueryAsync();
        return Results.Json(new { message = "Comment updated." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

// ?? Uploads proxy (pet photos, vaccination certificates) ?????????????????????
// Streams raw bytes from Node's /uploads static route with the original
// Content-Type header so <img src="/uploads/pets/1-photo.jpg"> renders in browser.
app.MapGet("/uploads/{**filePath}", async (string? filePath, IHttpClientFactory f) =>
{
    try
    {
        var segment = string.IsNullOrEmpty(filePath) ? "" : "/" + filePath;
        var client  = f.CreateClient();
        var resp    = await client.GetAsync($"{backendBase}/uploads{segment}");
        if (!resp.IsSuccessStatusCode)
            return Results.NotFound();
        var bytes       = await resp.Content.ReadAsByteArrayAsync();
        var contentType = resp.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
        return Results.Bytes(bytes, contentType);
    }
    catch
    {
        return Results.NotFound();
    }
});

// ?? DB users lister - shows all users WITHOUT passwords (developer diagnostic) ??
app.MapGet("/api/dbusers", async () =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = """
            SELECT u.id, u.name, u.mobile, u.email, u.role,
                   u.is_active, u.created_at,
                   c.name  AS city_name,
                   ng.name AS nigam_name,
                   z.name  AS zone_name,
                   w.ward_number
            FROM users u
            LEFT JOIN cities c  ON c.id  = u.city_id
            LEFT JOIN nigams ng ON ng.id = u.nigam_id
            LEFT JOIN zones  z  ON z.id  = u.zone_id
            LEFT JOIN wards  w  ON w.id  = u.ward_id
            ORDER BY
              CASE u.role
                WHEN 'super_admin' THEN 1 WHEN 'city_admin'  THEN 2
                WHEN 'nigam_admin' THEN 3 WHEN 'zone_admin'  THEN 4
                WHEN 'ward_admin'  THEN 5 ELSE 6 END,
              u.created_at
            """;
        await using var rdr = await cmd.ExecuteReaderAsync();
        return Results.Json(await ReadRows(rdr));
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

// ?? DB schema inspector - verifies all required columns exist in each table ??
app.MapGet("/api/dbschema", async () =>
{
    if (dbSource == null)
        return Results.Json(new { error = "Database not configured." }, statusCode: 503);
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = """
            SELECT table_name, column_name, data_type,
                   is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN (
                'users','pets','reports','report_comments',
                'discussions','discussion_replies',
                'cities','nigams','zones','wards',
                'doctors','shops'
              )
            ORDER BY table_name, ordinal_position
            """;
        await using var rdr = await cmd.ExecuteReaderAsync();
        var schema = new Dictionary<string, List<object>>();
        while (await rdr.ReadAsync())
        {
            var tbl = rdr.GetString(0);
            if (!schema.ContainsKey(tbl)) schema[tbl] = new();
            schema[tbl].Add(new {
                column   = rdr.GetString(1),
                type     = rdr.GetString(2),
                nullable = rdr.GetString(3),
                @default = rdr.IsDBNull(4) ? null : rdr.GetString(4)
            });
        }
        return Results.Json(schema);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

// ?? DB status diagnostic (safe - never exposes credentials) ????????????????
app.MapGet("/api/dbstatus", async () =>
{
    if (dbSource == null)
        return Results.Json(new {
            db          = "not_configured",
            has_url     = !string.IsNullOrEmpty(dbConnStr),
            has_pghost  = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PGHOST")),
            parsed_host = dbHost,
            init_error  = dbInitError,
        });
    if (dbConnectError != null)
        return Results.Json(new {
            db            = "connect_failed",
            host          = dbHost,
            connect_error = dbConnectError,
        }, statusCode: 500);
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*)::int FROM users";
        var count = await cmd.ExecuteScalarAsync();
        return Results.Json(new { db = "connected", host = dbHost, users = count });
    }
    catch (Exception ex)
    {
        return Results.Json(new { db = "error", host = dbHost, message = ex.Message }, statusCode: 500);
    }
});

// ?? Run pending migrations (one-click from super admin) ?????????????????
app.MapPost("/api/admin/run-migrations", async (HttpContext ctx, IHttpClientFactory f) =>
{
    try
    {
        var req = new HttpRequestMessage(HttpMethod.Post, $"{backendBase}/admin/run-migrations");
        req.Headers.TryAddWithoutValidation("x-migration-secret", "afp-migrate-2026");
        var auth = ctx.Request.Headers["Authorization"].FirstOrDefault();
        if (!string.IsNullOrEmpty(auth))
            req.Headers.TryAddWithoutValidation("Authorization", auth);
        var resp = await f.CreateClient().SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        return Results.Content(body, "application/json", statusCode: (int)resp.StatusCode);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = $"Migration proxy error: {ex.Message}" }, statusCode: 502);
    }
});

// ?? Discussions - implemented directly against PostgreSQL (old backend not redeployed)
app.MapGet("/api/discussions", async (HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var qs2   = ctx.Request.QueryString.Value ?? "";
            var resp2 = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/discussions{qs2}");
            return resp2.StatusCode == System.Net.HttpStatusCode.NotFound
                ? Results.Content("[]", "application/json") : await SafeGet(resp2, "[]");
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    try
    {
        var cat = ctx.Request.Query["category"].FirstOrDefault();
        var q   = ctx.Request.Query["q"].FirstOrDefault();
        var w   = new List<string>();
        var p   = new List<NpgsqlParameter>();
        int n   = 1;
        if (!string.IsNullOrEmpty(cat)) { w.Add($"d.category = ${n++}"); p.Add(new NpgsqlParameter { Value = cat }); }
        if (!string.IsNullOrEmpty(q))   { w.Add($"(d.title ILIKE ${n} OR d.body ILIKE ${n})"); n++; p.Add(new NpgsqlParameter { Value = $"%{q}%" }); }
        var ws = w.Count > 0 ? "WHERE " + string.Join(" AND ", w) : "";
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT d.*, u.name AS author_name, COUNT(r.id)::int AS reply_count
            FROM discussions d
            LEFT JOIN users u ON u.id = d.user_id
            LEFT JOIN discussion_replies r ON r.discussion_id = d.id
            {ws}
            GROUP BY d.id, u.name ORDER BY d.created_at DESC LIMIT 100
            """;
        foreach (var pm in p) cmd.Parameters.Add(pm);
        await using var rdr = await cmd.ExecuteReaderAsync();
        return Results.Json(await ReadRows(rdr));
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapGet("/api/discussions/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var resp2 = await MakeClient(f, ctx.Request).GetAsync($"{backendBase}/api/discussions/{id}");
            return resp2.StatusCode == System.Net.HttpStatusCode.NotFound
                ? Results.Json(new { error = "Discussion not found." }, statusCode: 404) : await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var cmd  = conn.CreateCommand();
        cmd.CommandText = """
            SELECT d.*, u.name AS author_name, COUNT(r.id)::int AS reply_count
            FROM discussions d
            LEFT JOIN users u ON u.id = d.user_id
            LEFT JOIN discussion_replies r ON r.discussion_id = d.id
            WHERE d.id = $1 GROUP BY d.id, u.name
            """;
        cmd.Parameters.Add(new NpgsqlParameter { Value = id });
        await using var rdr  = await cmd.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        if (rows.Count == 0) return Results.Json(new { error = "Discussion not found." }, statusCode: 404);
        var thread = rows[0];
        await rdr.DisposeAsync(); await cmd.DisposeAsync();
        await using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = """
            SELECT r.*, u.name AS author_name
            FROM discussion_replies r LEFT JOIN users u ON u.id = r.user_id
            WHERE r.discussion_id = $1 ORDER BY r.created_at ASC
            """;
        cmd2.Parameters.Add(new NpgsqlParameter { Value = id });
        await using var rdr2 = await cmd2.ExecuteReaderAsync();
        thread["replies"] = await ReadRows(rdr2);
        return Results.Json(thread);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPost("/api/discussions", async (HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var body2 = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            var resp2 = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/discussions",
                new StringContent(body2, System.Text.Encoding.UTF8, "application/json"));
            return await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        var bodyStr  = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var title    = doc.RootElement.TryGetProperty("title",    out var t) ? t.GetString() : null;
        var bodyText = doc.RootElement.TryGetProperty("body",     out var b) ? b.GetString() : null;
        var category = doc.RootElement.TryGetProperty("category", out var c) ? c.GetString() : "general";
        if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(bodyText))
            return Results.Json(new { error = "title and body are required." }, statusCode: 400);
        if (title.Length > 200)
            return Results.Json(new { error = "Title must be 200 characters or less." }, statusCode: 400);
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var ins  = conn.CreateCommand();
        ins.CommandText = "INSERT INTO discussions (user_id, title, body, category) VALUES ($1,$2,$3,$4) RETURNING id";
        ins.Parameters.Add(new NpgsqlParameter { Value = uid.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = title.Trim() });
        ins.Parameters.Add(new NpgsqlParameter { Value = bodyText.Trim() });
        ins.Parameters.Add(new NpgsqlParameter { Value = category ?? "general" });
        var newId = (int)(await ins.ExecuteScalarAsync())!;
        await ins.DisposeAsync();
        await using var sel = conn.CreateCommand();
        sel.CommandText = """
            SELECT d.*, u.name AS author_name, 0::int AS reply_count
            FROM discussions d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = $1
            """;
        sel.Parameters.Add(new NpgsqlParameter { Value = newId });
        await using var rdr = await sel.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        return Results.Json(rows.Count > 0 ? (object)rows[0] : new { id = newId }, statusCode: 201);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPut("/api/discussions/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var body2 = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            var resp2 = await MakeClient(f, ctx.Request).PutAsync($"{backendBase}/api/discussions/{id}",
                new StringContent(body2, System.Text.Encoding.UTF8, "application/json"));
            return await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        var bodyStr  = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var title    = doc.RootElement.TryGetProperty("title", out var t) ? t.GetString() : null;
        var bodyText = doc.RootElement.TryGetProperty("body",  out var b) ? b.GetString() : null;
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT user_id FROM discussions WHERE id = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        var ownerId = await chk.ExecuteScalarAsync();
        if (ownerId == null || ownerId is DBNull) return Results.Json(new { error = "Discussion not found." }, statusCode: 404);
        if ((int)ownerId != uid.Value) return Results.Json(new { error = "You can only edit your own posts." }, statusCode: 403);
        await chk.DisposeAsync();
        await using var upd = conn.CreateCommand();
        upd.CommandText = "UPDATE discussions SET title=COALESCE($1,title), body=COALESCE($2,body), updated_at=NOW() WHERE id=$3";
        upd.Parameters.Add(new NpgsqlParameter { Value = (object?)title?.Trim() ?? DBNull.Value });
        upd.Parameters.Add(new NpgsqlParameter { Value = (object?)bodyText?.Trim() ?? DBNull.Value });
        upd.Parameters.Add(new NpgsqlParameter { Value = id });
        await upd.ExecuteNonQueryAsync();
        return Results.Json(new { message = "Updated." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapDelete("/api/discussions/{id:int}", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var resp2 = await MakeClient(f, ctx.Request).DeleteAsync($"{backendBase}/api/discussions/{id}");
            return await SafeGet(resp2, "{}");
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT user_id FROM discussions WHERE id = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        var ownerId = await chk.ExecuteScalarAsync();
        if (ownerId == null || ownerId is DBNull) return Results.Json(new { error = "Discussion not found." }, statusCode: 404);
        if ((int)ownerId != uid.Value) return Results.Json(new { error = "You can only delete your own posts." }, statusCode: 403);
        await chk.DisposeAsync();
        await using var del = conn.CreateCommand();
        del.CommandText = "DELETE FROM discussions WHERE id = $1";
        del.Parameters.Add(new NpgsqlParameter { Value = id });
        await del.ExecuteNonQueryAsync();
        return Results.Json(new { message = "Deleted." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPost("/api/discussions/{id:int}/replies", async (int id, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var body2 = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            var resp2 = await MakeClient(f, ctx.Request).PostAsync($"{backendBase}/api/discussions/{id}/replies",
                new StringContent(body2, System.Text.Encoding.UTF8, "application/json"));
            return await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        var bodyStr  = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var text = doc.RootElement.TryGetProperty("body", out var b) ? b.GetString()?.Trim() : null;
        if (string.IsNullOrWhiteSpace(text))
            return Results.Json(new { error = "Reply body is required." }, statusCode: 400);
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT id FROM discussions WHERE id = $1";
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        if (await chk.ExecuteScalarAsync() == null)
            return Results.Json(new { error = "Discussion not found." }, statusCode: 404);
        await chk.DisposeAsync();
        await using var ins = conn.CreateCommand();
        ins.CommandText = "INSERT INTO discussion_replies (discussion_id, user_id, body) VALUES ($1,$2,$3) RETURNING id";
        ins.Parameters.Add(new NpgsqlParameter { Value = id });
        ins.Parameters.Add(new NpgsqlParameter { Value = uid.Value });
        ins.Parameters.Add(new NpgsqlParameter { Value = text });
        var newId = (int)(await ins.ExecuteScalarAsync())!;
        await ins.DisposeAsync();
        await using var sel = conn.CreateCommand();
        sel.CommandText = "SELECT r.*, u.name AS author_name FROM discussion_replies r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = $1";
        sel.Parameters.Add(new NpgsqlParameter { Value = newId });
        await using var rdr = await sel.ExecuteReaderAsync();
        var rows = await ReadRows(rdr);
        return Results.Json(rows.Count > 0 ? (object)rows[0] : new { id = newId }, statusCode: 201);
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapPut("/api/discussions/{id:int}/replies/{rid:int}", async (int id, int rid, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var body2 = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
            var resp2 = await MakeClient(f, ctx.Request).PutAsync(
                $"{backendBase}/api/discussions/{id}/replies/{rid}",
                new StringContent(body2, System.Text.Encoding.UTF8, "application/json"));
            return await SafeGet(resp2);
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        var bodyStr  = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(bodyStr);
        var text = doc.RootElement.TryGetProperty("body", out var b) ? b.GetString()?.Trim() : null;
        if (string.IsNullOrWhiteSpace(text))
            return Results.Json(new { error = "Reply body is required." }, statusCode: 400);
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT user_id FROM discussion_replies WHERE id = $1 AND discussion_id = $2";
        chk.Parameters.Add(new NpgsqlParameter { Value = rid });
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        var ownerId = await chk.ExecuteScalarAsync();
        if (ownerId == null || ownerId is DBNull) return Results.Json(new { error = "Reply not found." }, statusCode: 404);
        if ((int)ownerId != uid.Value) return Results.Json(new { error = "You can only edit your own replies." }, statusCode: 403);
        await chk.DisposeAsync();
        await using var upd = conn.CreateCommand();
        upd.CommandText = "UPDATE discussion_replies SET body = $1, updated_at = NOW() WHERE id = $2";
        upd.Parameters.Add(new NpgsqlParameter { Value = text });
        upd.Parameters.Add(new NpgsqlParameter { Value = rid });
        await upd.ExecuteNonQueryAsync();
        return Results.Json(new { message = "Updated." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.MapDelete("/api/discussions/{id:int}/replies/{rid:int}", async (int id, int rid, HttpContext ctx, IHttpClientFactory f) =>
{
    if (dbSource == null)
    {
        try
        {
            var resp2 = await MakeClient(f, ctx.Request).DeleteAsync(
                $"{backendBase}/api/discussions/{id}/replies/{rid}");
            return await SafeGet(resp2, "{}");
        }
        catch (Exception ex) { return Results.Json(new { error = $"Backend unreachable: {ex.Message}" }, statusCode: 502); }
    }
    var uid = GetUserId(ctx.Request);
    if (uid == null) return Results.Json(new { error = "No token provided." }, statusCode: 401);
    try
    {
        await using var conn = await dbSource.OpenConnectionAsync();
        await using var chk  = conn.CreateCommand();
        chk.CommandText = "SELECT user_id FROM discussion_replies WHERE id = $1 AND discussion_id = $2";
        chk.Parameters.Add(new NpgsqlParameter { Value = rid });
        chk.Parameters.Add(new NpgsqlParameter { Value = id });
        var ownerId = await chk.ExecuteScalarAsync();
        if (ownerId == null || ownerId is DBNull) return Results.Json(new { error = "Reply not found." }, statusCode: 404);
        if ((int)ownerId != uid.Value) return Results.Json(new { error = "You can only delete your own replies." }, statusCode: 403);
        await chk.DisposeAsync();
        await using var del = conn.CreateCommand();
        del.CommandText = "DELETE FROM discussion_replies WHERE id = $1";
        del.Parameters.Add(new NpgsqlParameter { Value = rid });
        await del.ExecuteNonQueryAsync();
        return Results.Json(new { message = "Deleted." });
    }
    catch (Exception ex) { return Results.Json(new { error = ex.Message }, statusCode: 500); }
});

app.Run();
