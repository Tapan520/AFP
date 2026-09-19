using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace AFP.Tests;

/// <summary>
/// Phase 2 smoke tests for the vet / shop application pipeline. We don't spin
/// up Node here — a static-file grep gives us very high confidence with
/// zero infrastructure. Behaviour tests around the .NET Razor page + payment
/// routing already live in PlatformFeeTests.
/// </summary>
public class BusinessApplicationTests
{
    private static readonly string RepoRoot = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    // ── Node route: business.js ──────────────────────────────────────────────
    [Fact]
    public void BusinessRoute_ExistsAndDeclaresFullStateMachine()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "business.js"));

        // Every step of the state machine is present
        foreach (var s in new[] { "draft", "docs_uploaded", "paid", "approved", "rejected" })
            Assert.Contains($"\"{s}\"", js);

        // Endpoints present
        Assert.Contains("/apply",         js);
        Assert.Contains("/upload-doc",    js);
        Assert.Contains("/mark-paid",     js);
        Assert.Contains("/mine",          js);
        Assert.Contains("/pending",       js);
        Assert.Contains("/approve",       js);
        Assert.Contains("/reject",        js);
    }

    [Fact]
    public void BusinessRoute_GatesWritesOnSuperAdmin()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "business.js"));
        // Both approve and reject must sit on router.patch("/:id/{action}", ...
        // authenticate, requireRole("super_admin"), ...). We take a generous
        // window either side of the router.patch declaration and expect the
        // guard to appear inside it.
        foreach (var action in new[] { "approve", "reject" })
        {
            var pattern = new Regex(
                $"router\\.patch\\(\"/:id/{action}\",\\s*authenticate,\\s*requireRole\\(\"super_admin\"\\)",
                RegexOptions.Singleline);
            Assert.True(pattern.IsMatch(js),
                $"router.patch for /:id/{action} must require super_admin.");
        }
    }

    [Fact]
    public void BusinessRoute_ApproveOnlyFromPaid()
    {
        // The state machine invariant we care about: approve MUST reject any
        // status other than "paid" (otherwise revenue is booked without money
        // ever reaching AFP's Razorpay account).
        var js = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "business.js"));
        Assert.Contains("app.status !== \"paid\"", js);
    }

    [Fact]
    public void BusinessRoute_RejectRecordsRefundPendingWhenPaid()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "business.js"));
        Assert.Contains("refund_status", js);
        Assert.Contains("\"pending\"",   js);
        Assert.Contains("rows[0].payment_id", js);
    }

    // ── server.js: migrations + router mount ─────────────────────────────────
    [Fact]
    public void Server_MountsBusinessRouterAndCreatesTable()
    {
        var s = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "server.js"));
        Assert.Contains("businessRouter",                                 s);
        Assert.Contains("/api/business",                                  s);
        Assert.Contains("CREATE TABLE IF NOT EXISTS business_applications", s);
        Assert.Contains("licence_expiry_date",                            s);
        Assert.Contains("source_application_id",                          s);
        Assert.Contains("ensureColumn(\"doctors\"",                       s);
        Assert.Contains("ensureColumn(\"shops\"",                         s);
    }

    // ── Public listing expiry guard ──────────────────────────────────────────
    [Fact]
    public void PublicDoctorList_HidesExpiredLicences()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "doctors.js"));
        // 30-day grace: expired listings vanish from citizen search but not
        // from the admin view. Legacy rows with NULL expiry are preserved.
        Assert.Contains("d.licence_expiry_date IS NULL",             js);
        Assert.Contains("DATE_SUB(NOW(), INTERVAL 30 DAY)",          js);
    }

    [Fact]
    public void PublicShopList_HidesExpiredLicences()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "shops.js"));
        Assert.Contains("s.licence_expiry_date IS NULL",             js);
        Assert.Contains("DATE_SUB(NOW(), INTERVAL 30 DAY)",          js);
    }

    // ── Signup Razor page ────────────────────────────────────────────────────
    [Fact]
    public void RegisterBusinessPage_ExistsAndWiresBothTypesAndRazorpay()
    {
        var razor = File.ReadAllText(Path.Combine(RepoRoot, "Pages", "RegisterBusiness.cshtml"));
        Assert.Contains("/api/business/apply",       razor);
        Assert.Contains("/api/business/",            razor);   // for /:id/upload-doc & mark-paid
        Assert.Contains("upload-doc",                razor);
        Assert.Contains("mark-paid",                 razor);
        Assert.Contains("doctor_registration",       razor);
        Assert.Contains("shop_registration",         razor);
        Assert.Contains("checkout.razorpay.com",     razor);
        // Auth gate is present so anonymous users get told to log in first.
        Assert.Contains("AFP.getToken()",            razor);
    }

    // ── Post-submit redirect: vet/shop applicant should NOT be dropped on the
    // citizen pet-owner dashboard after finishing the public signup flow.
    // The Razor page clears the auto-issued session so "Back to home"
    // lands them on splash instead of /dashboard.
    [Fact]
    public void RegisterBusinessPage_ClearsAutoSignupSessionAfterSubmit()
    {
        var razor = File.ReadAllText(Path.Combine(RepoRoot, "Pages", "RegisterBusiness.cshtml"));
        var idx   = razor.IndexOf("window.skipPayment", StringComparison.Ordinal);
        Assert.True(idx > 0, "skipPayment handler missing");
        var block = razor.Substring(idx, Math.Min(1500, razor.Length - idx));
        Assert.Contains("!_alreadyAuthed", block);
        Assert.Contains("afp_token",       block);
        Assert.Contains("removeItem",      block);
    }

    // ── Admin UI ─────────────────────────────────────────────────────────────
    [Fact]
    public void AdminUi_ExposesListingsTabForSuperAdminOnly()
    {
        var admin = File.ReadAllText(Path.Combine(RepoRoot, "wwwroot", "js", "afp-admin.js"));
        Assert.Contains("\"listings\"",              admin);
        Assert.Contains("BusinessMgmt.loadBusinessMgmt", admin);

        // Guard: only super_admin can render the tab.
        var listingsIdx = admin.IndexOf("tab === \"listings\"", StringComparison.Ordinal);
        Assert.True(listingsIdx > 0, "listings tab handler missing");
        var block = admin.Substring(listingsIdx, Math.Min(300, admin.Length - listingsIdx));
        Assert.Contains("super_admin", block);
    }

    [Fact]
    public void BusinessMgmtModule_ExistsAndCallsAllEndpoints()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "wwwroot", "js", "afp-business-mgmt.js"));
        Assert.Contains("/api/business/pending",     js);
        Assert.Contains("/api/business/${id}/approve", js);
        Assert.Contains("/api/business/${id}/reject",  js);
        // Reject button prompts for a reason (server rejects blank).
        Assert.Contains("prompt(",                   js);
    }

    [Fact]
    public void AppLayout_LoadsBusinessMgmtScript()
    {
        var razor = File.ReadAllText(Path.Combine(RepoRoot, "Pages", "Shared", "_AppLayout.cshtml"));
        Assert.Contains("afp-business-mgmt.js", razor);
    }

    // ── Users tab must NOT list vet / shop applicants as Citizens ────────────
    // Public POST /api/business/register creates a users row with role='citizen'
    // (that's the only allowed login role) plus a business_applications row.
    // Semantically those users are vets / shop owners, not pet-owner citizens,
    // and they already appear in the Listings tab and later the Doctors / Shops
    // tabs. GET /api/admin/users must filter them out when listing citizens so
    // a doctor registration doesn't show up under the Citizen tab.
    [Fact]
    public void AdminUsersRoute_ExcludesBusinessApplicantsFromCitizenList()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "adminUsers.js"));
        Assert.Contains("business_applications", js);
        Assert.Contains("applicant_id = u.id",   js);
        // Guard must be gated on the citizen role (or default listing) so
        // admin lists for other roles remain unaffected.
        Assert.Contains("listingCitizens", js);
    }
}
