using System.IO;
using System.Text.RegularExpressions;

namespace AFP.Tests;

/// <summary>
/// Smoke tests for the Ratings &amp; Feedback module.
///
/// Because the Node backend runs against MySQL via a PostgreSQL-syntax shim
/// (see railway-backend/db.js) we cannot spin the whole stack up here without
/// a live DB. These tests use static file grep to guarantee that the fixed
/// contract is present and that regressions in either the backend upsert,
/// the admin listing endpoint, or the client-side wiring will fail the build.
/// </summary>
public sealed class RatingsFeedbackTests
{
    private static readonly string RepoRoot = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    private static string ReadFile(params string[] segments) =>
        File.ReadAllText(Path.Combine(new[] { RepoRoot }.Concat(segments).ToArray()));

    // ── Backend: MySQL-native upsert (insertion + update) ──────────────────
    // The MySQL shim in db.js only translates ON CONFLICT ... DO NOTHING.
    // The rating upsert therefore MUST use ON DUPLICATE KEY UPDATE with the
    // VALUES(col) form so both INSERT (first rating) and UPDATE (re-rate)
    // reach the database.
    [Fact]
    public void RatingsRoute_UpsertUsesMySqlOnDuplicateKeyUpdate()
    {
        var js = ReadFile("railway-backend", "routes", "ratings.js");
        Assert.Contains("INSERT INTO ratings",     js);
        Assert.Contains("ON DUPLICATE KEY UPDATE", js);
        Assert.Contains("VALUES(stars)",           js);
        Assert.Contains("VALUES(comment)",         js);
        Assert.Contains("updated_at = NOW()",      js);

        // The legacy Postgres-only form must be gone or the shim will fail
        // silently and the row will never land.
        Assert.DoesNotContain("EXCLUDED.stars",   js);
        Assert.DoesNotContain("EXCLUDED.comment", js);
        Assert.DoesNotContain("ON CONFLICT (user_id, target_type, target_id)", js);
    }

    [Fact]
    public void RatingsRoute_UpsertSurfacesRealErrorMessage()
    {
        var js = ReadFile("railway-backend", "routes", "ratings.js");
        // Diagnostic error propagation added after the silent-failure incident.
        Assert.Contains("Failed to save rating: ", js);
        Assert.Contains("err.stack",               js);
    }

    // ── Backend: table + unique index migrations exist ─────────────────────
    [Fact]
    public void ServerJs_CreatesRatingsTableAndUniqueIndex()
    {
        var server = ReadFile("railway-backend", "server.js");
        Assert.Contains("CREATE TABLE IF NOT EXISTS ratings", server);
        Assert.Contains("target_type", server);
        Assert.Contains("target_id",   server);
        Assert.Contains("idx_ratings_user_target", server);
        Assert.Contains("UNIQUE INDEX IF NOT EXISTS idx_ratings_user_target", server);
        Assert.Contains("app.use(\"/api/ratings\", ratingsRouter)", server);
    }

    // ── Backend: admin listing endpoint (ward_admin and above) ─────────────
    [Fact]
    public void RatingsRoute_ExposesAdminListingEndpoint()
    {
        var js = ReadFile("railway-backend", "routes", "ratings.js");
        Assert.Contains("router.get(\"/admin\"", js);
        Assert.Contains("requireRole(\"ward_admin\")", js);
        // Filters
        Assert.Contains("r.target_type = $",  js);
        Assert.Contains("r.stars = $",        js);
        Assert.Contains("ORDER BY r.updated_at DESC", js);
        // Summary block
        Assert.Contains("AVG(stars)",         js);
        Assert.Contains("doctor_count",       js);
        Assert.Contains("shop_count",         js);
    }

    // ── Backend: citizen endpoints still there ─────────────────────────────
    [Fact]
    public void RatingsRoute_ExposesCitizenEndpoints()
    {
        var js = ReadFile("railway-backend", "routes", "ratings.js");
        Assert.Contains("router.get(\"/targets\"",  js);
        Assert.Contains("router.get(\"/mine\"",     js);
        Assert.Contains("router.post(\"/\"",        js);
        Assert.Contains("router.delete(\"/:id\"",   js);
    }

    // ── Frontend: SPA router registers a loader for the ratings screen ─────
    // This is the fix that first made the screen render at all — without it
    // Ratings.load() never ran and users saw an empty page.
    [Fact]
    public void CoreJs_RouterRegistersRatingsLoader()
    {
        var js = ReadFile("wwwroot", "js", "afp-core.js");
        Assert.Matches(new Regex(@"ratings:\s*typeof\s+loadRatings\s*===\s*""function"""), js);
    }

    // ── Frontend: ratings module wires the UI + posts to the API ───────────
    [Fact]
    public void RatingsJs_PostsToApiAndReloadsAfterSave()
    {
        var js = ReadFile("wwwroot", "js", "afp-ratings.js");
        // Module exports + global alias
        Assert.Contains("const Ratings = (() => {", js);
        Assert.Contains("function loadRatings()",   js);
        // Save flow — hits POST /api/ratings and refreshes the list
        Assert.Contains("AFP.POST(\"/api/ratings\"", js);
        Assert.Contains("targetType",               js);
        Assert.Contains("targetId",                 js);
        Assert.Contains("await _loadTargets();",    js);
        // Remove flow deletes by rating id
        Assert.Contains("AFP.DELETE(`/api/ratings/${ratingId}`)", js);
    }

    // ── Frontend: admin panel has a Feedback tab wired to the new endpoint ─
    [Fact]
    public void AdminJs_HasFeedbackTabWiredToAdminEndpoint()
    {
        var js = ReadFile("wwwroot", "js", "afp-admin.js");
        // Tab entry + dispatcher branch
        Assert.Contains("key: \"feedback\"", js);
        Assert.Contains("tab === \"feedback\"", js);
        Assert.Contains("renderAdminFeedback(body)", js);
        // Calls the new admin endpoint we just added
        Assert.Contains("/api/ratings/admin", js);
        // Summary + list renderers exist
        Assert.Contains("_renderAdminFeedbackSummary", js);
        Assert.Contains("_renderAdminFeedbackList",    js);
        // Debounced search box
        Assert.Contains("adminFeedbackDebouncedApply", js);
    }

    // ── Screen shell + dashboard tile stay wired ───────────────────────────
    [Fact]
    public void CitizenServices_ContainsRatingsScreenShell()
    {
        var razor = ReadFile("Pages", "Shared", "Partials", "_CitizenServices.cshtml");
        Assert.Contains("id=\"screen-ratings\"", razor);
        Assert.Contains("id=\"ratings-body\"",   razor);
    }

    [Fact]
    public void DashboardTile_LinksToRatingsScreen()
    {
        var js = ReadFile("wwwroot", "js", "afp-screens.js");
        Assert.Contains("AFP.go('ratings')",   js);
        Assert.Contains("Ratings &amp; feedback", js);
    }

    // ── Client-side layout loads the ratings module ────────────────────────
    [Fact]
    public void AppLayout_IncludesRatingsScript()
    {
        var razor = ReadFile("Pages", "Shared", "_AppLayout.cshtml");
        Assert.Contains("js/afp-ratings.js", razor);
    }
}
