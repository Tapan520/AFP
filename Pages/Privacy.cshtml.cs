using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AFP.Pages;

public class PrivacyModel : PageModel
{
    // Bump this whenever the policy text below is updated. Google Play and
    // most data-protection regulators (DPDP Act, GDPR) expect an effective
    // date so users can see when terms changed.
    public string LastUpdated { get; } = "15 November 2025";

    public void OnGet() { }
}
