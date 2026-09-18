using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AFP.Pages;

// Static pricing / sales page. Kept as a Razor Page so we can later hook up
// a real "Contact Sales" form handler (see the @@section Scripts in .cshtml).
public class PricingModel : PageModel
{
    public void OnGet() { }
}
