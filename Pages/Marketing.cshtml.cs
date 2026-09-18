using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AFP.Pages;

// Static landing page — no data binding needed. A code-behind is kept so the
// page can be extended later (e.g. contact form, A/B experiments).
public class MarketingModel : PageModel
{
    public void OnGet() { }
}
