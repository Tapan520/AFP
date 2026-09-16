using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;

namespace AFP.Services;

/// <summary>
/// Resolves a static asset path (e.g. "js/afp-core.js") to either a local URL
/// (with a mtime-based version query so browsers/CDNs bust cache on change) or
/// a fully-qualified CDN URL when <c>Cdn:BaseUrl</c> is configured.
/// </summary>
public sealed class CdnUrlResolver
{
    private readonly IWebHostEnvironment _env;
    private readonly string? _baseUrl;

    public CdnUrlResolver(IWebHostEnvironment env, IConfiguration cfg)
    {
        _env     = env;
        _baseUrl = cfg["Cdn:BaseUrl"]?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(_baseUrl)) _baseUrl = null;
    }

    /// <summary>true when a CDN base URL is configured.</summary>
    public bool CdnEnabled => _baseUrl is not null;

    /// <summary>
    /// Resolve a relative wwwroot path such as "js/afp-core.js" to a
    /// browser-usable URL with a version stamp for cache busting.
    /// </summary>
    public string Resolve(string relativePath)
    {
        var clean = relativePath.TrimStart('/', '~');
        var version = GetVersion(clean);
        var query   = version is null ? string.Empty : $"?v={version}";
        return _baseUrl is null ? $"/{clean}{query}" : $"{_baseUrl}/{clean}{query}";
    }

    private string? GetVersion(string relative)
    {
        try
        {
            var file = _env.WebRootFileProvider.GetFileInfo(relative);
            if (file.Exists && file.LastModified != default)
            {
                return file.LastModified.ToUnixTimeSeconds().ToString();
            }
        }
        catch { /* ignore — version stamp is best-effort */ }
        return null;
    }
}
