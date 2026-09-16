using System.IO;

namespace AFP.Tests;

/// <summary>
/// Smoke tests for the security / DX enhancements batch:
///   1. helmet() + express-rate-limit wired into server.js
///   2. Hard-coded Admin@123 replaced with SA_PASSWORD env var
///   3. .editorconfig present with expected rules
///   4. README.md has a "Run locally" section with .NET and Node commands
///   5. Password minimum length = 8 in both auth.js AND adminUsers.js
/// </summary>
public sealed class SecurityHardeningTests
{
    private static readonly string RepoRoot = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

    // ── #1 helmet + rate-limit ────────────────────────────────────────────
    [Fact]
    public void ServerJs_UsesHelmetAndRateLimit()
    {
        var server = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "server.js"));
        Assert.Contains("require(\"helmet\")",              server);
        Assert.Contains("require(\"express-rate-limit\")",  server);
        Assert.Contains("app.use(helmet(",                  server);
        // Global limiter and a stricter auth-scoped limiter
        Assert.Matches(@"app\.use\(rateLimit\(", server);
        Assert.Contains("/api/auth", server);
        Assert.Contains("max: 20",   server); // strict auth throttle
    }

    [Fact]
    public void PackageJson_DeclaresHelmetAndRateLimitDeps()
    {
        var path = Path.Combine(RepoRoot, "railway-backend", "package.json");
        using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
        var deps = doc.RootElement.GetProperty("dependencies");
        Assert.True(deps.TryGetProperty("helmet",              out _), "helmet missing from dependencies");
        Assert.True(deps.TryGetProperty("express-rate-limit",  out _), "express-rate-limit missing from dependencies");
    }

    // ── #2 test-portal.js reads password from env ─────────────────────────
    [Fact]
    public void TestPortal_UsesEnvForSuperAdminPassword_NoHardcodedSecret()
    {
        var js = File.ReadAllText(Path.Combine(RepoRoot, "test-portal.js"));
        Assert.Contains("process.env.SA_PASSWORD", js);
        Assert.Contains("process.env.SA_MOBILE",   js);
        Assert.Contains("SA_PASSWORD", js);
        // The literal hard-coded default must be gone from every login call
        Assert.DoesNotContain("password: 'Admin@123'", js);
        Assert.DoesNotContain("password: \"Admin@123\"", js);
    }

    // ── #3 .editorconfig ──────────────────────────────────────────────────
    [Fact]
    public void EditorConfig_ExistsAndCoversJsAndCSharp()
    {
        var path = Path.Combine(RepoRoot, ".editorconfig");
        Assert.True(File.Exists(path), ".editorconfig must exist at repo root");
        var text = File.ReadAllText(path, System.Text.Encoding.UTF8);
        Assert.Contains("root = true",              text);
        Assert.Matches(@"indent_style\s*=\s*space", text);
        Assert.Contains("[*.{js,",                  text); // JS section present
        Assert.Contains("[*.{cs,",                  text); // C# section present
        Assert.Contains("insert_final_newline",     text);
        Assert.Contains("trim_trailing_whitespace", text);
    }

    // ── #4 README "Run locally" ───────────────────────────────────────────
    [Fact]
    public void Readme_HasRunLocallySectionWithBothProjects()
    {
        var path = Path.Combine(RepoRoot, "README.md");
        Assert.True(File.Exists(path), "README.md must exist");
        var md = File.ReadAllText(path);
        Assert.Contains("Run locally",         md);
        Assert.Contains("dotnet run",          md);
        Assert.Contains("npm install",         md);
        Assert.Contains("npm start",           md); // or npm run dev
        Assert.Contains("railway-backend",     md);
        Assert.Contains("dotnet test",         md);
    }

    // ── #5 Password minimum length ≥ 8 (both auth.js AND adminUsers.js) ──
    [Fact]
    public void Auth_EnforcesMinimumPasswordLengthOfEight()
    {
        var auth = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "auth.js"));
        Assert.Matches(@"PASSWORD_MIN\s*=\s*8", auth);
        Assert.Contains(".{8,}", auth); // regex enforces 8+ chars
        Assert.Contains("validatePassword", auth);
        // Exported for reuse in adminUsers.js
        Assert.Contains("module.exports.validatePassword", auth);
    }

    [Fact]
    public void AdminUsers_ReusesValidatePasswordOnCreateAndUpdate()
    {
        var admin = File.ReadAllText(Path.Combine(RepoRoot, "railway-backend", "routes", "adminUsers.js"));
        Assert.Contains("validatePassword", admin);
        // Both the POST (create) and PATCH/PUT (update) paths must invoke it
        var occurrences = System.Text.RegularExpressions.Regex.Matches(admin, @"validatePassword\(");
        Assert.True(occurrences.Count >= 2,
            $"Expected validatePassword() called on both create and update paths; found {occurrences.Count}");
    }
}
