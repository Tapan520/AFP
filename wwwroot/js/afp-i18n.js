// ?????????????????????????????????????????????????????????????????????????????
// afp-i18n.js — Minimal English / Hindi runtime translator.
//
// Hindi strings are stored as \uXXXX escape sequences so this file stays
// pure ASCII on disk (survives every editor / build pipeline). Browsers
// decode them back to Devanagari at parse time.
//
// Usage in HTML:
//   <button data-i18n="btn.login">Login</button>
//   <input placeholder="Search…" data-i18n-attr="placeholder" data-i18n="search.placeholder" />
//
// Usage in JS:
//   I18n.t("btn.login")
//   I18n.setLang("hi")
//
// The chosen language is persisted to localStorage under `afp_lang`.
// ?????????????????????????????????????????????????????????????????????????????
const I18n = (() => {
    const DICT = {
        en: {
            "app.title":          "All For Pets",
            "app.tagline":        "Register, manage and track your pets with your city municipality",
            "btn.register":       "Register",
            "btn.login":          "Login",
            "btn.logout":         "Logout",
            "btn.close":          "Close",
            "btn.cancel":         "Cancel",
            "btn.save":           "Save",
            "btn.approve":        "Approve",
            "btn.reject":         "Reject",
            "btn.download":       "Download",
            "btn.share":          "Share",
            "btn.staffLogin":     "Municipal Staff Login",
            "nav.home":           "Home",
            "nav.search":         "Search",
            "nav.stats":          "Stats",
            "nav.profile":        "Profile",
            "auth.welcome":       "Welcome back",
            "auth.subtitle":      "Login to manage your pets",
            "auth.remember":      "Remember me on this device",
            "auth.create":        "Create Account \u2192",
            "auth.mobileOrEmail": "Mobile or Email",
            "auth.password":      "Password",
            "field.fullName":     "Full name *",
            "field.mobile":       "Mobile *",
            "field.email":        "Email *",
            "field.address":      "Address *",
            "field.city":         "City *",
            "field.nigam":        "Nigam *",
            "field.zone":         "Zone *",
            "field.ward":         "Ward *",
            "pet.qrTitle":        "Pet QR Code",
            "pet.qrSub":          "Scan to identify your pet",
            "pet.shareQR":        "Share QR Code",
            "pet.licenceValid":   "Valid until",
            "admin.overview":     "Overview",
            "admin.pending":      "Pending",
            "admin.approved":     "Approved",
            "admin.analytics":    "Analytics",
            "lang.toggle":        "\u0939\u093F\u0928\u094D\u0926\u0940",
        },
        hi: {
            // "All For Pets" \u2192 hi
            "app.title":          "\u0911\u0932 \u092B\u093C\u0949\u0930 \u092A\u0947\u091F\u094D\u0938",
            "app.tagline":        "\u0905\u092A\u0928\u0947 \u0936\u0939\u0930 \u0915\u0940 \u0928\u0917\u0930\u092A\u093E\u0932\u093F\u0915\u093E \u0915\u0947 \u0938\u093E\u0925 \u0905\u092A\u0928\u0947 \u092A\u093E\u0932\u0924\u0942 \u091C\u093E\u0928\u0935\u0930\u094B\u0902 \u0915\u094B \u092A\u0902\u091C\u0940\u0915\u0943\u0924 \u0915\u0930\u0947\u0902, \u092A\u094D\u0930\u092C\u0902\u0927\u093F\u0924 \u0915\u0930\u0947\u0902 \u0914\u0930 \u091F\u094D\u0930\u0948\u0915 \u0915\u0930\u0947\u0902",
            "btn.register":       "\u092A\u0902\u091C\u0940\u0915\u0930\u0923",
            "btn.login":          "\u0932\u0949\u0917\u093F\u0928",
            "btn.logout":         "\u0932\u0949\u0917\u0906\u0909\u091F",
            "btn.close":          "\u092C\u0902\u0926 \u0915\u0930\u0947\u0902",
            "btn.cancel":         "\u0930\u0926\u094D\u0926 \u0915\u0930\u0947\u0902",
            "btn.save":           "\u0938\u0939\u0947\u091C\u0947\u0902",
            "btn.approve":        "\u0938\u094D\u0935\u0940\u0915\u0943\u0924 \u0915\u0930\u0947\u0902",
            "btn.reject":         "\u0905\u0938\u094D\u0935\u0940\u0915\u093E\u0930 \u0915\u0930\u0947\u0902",
            "btn.download":       "\u0921\u093E\u0909\u0928\u0932\u094B\u0921",
            "btn.share":          "\u0938\u093E\u091D\u093E \u0915\u0930\u0947\u0902",
            "btn.staffLogin":     "\u0928\u0917\u0930\u092A\u093E\u0932\u093F\u0915\u093E \u0915\u0930\u094D\u092E\u091A\u093E\u0930\u0940 \u0932\u0949\u0917\u093F\u0928",
            "nav.home":           "\u0939\u094B\u092E",
            "nav.search":         "\u0916\u094B\u091C",
            "nav.stats":          "\u0906\u0902\u0915\u0921\u093C\u0947",
            "nav.profile":        "\u092A\u094D\u0930\u094B\u092B\u093C\u093E\u0907\u0932",
            "auth.welcome":       "\u092A\u0941\u0928\u0903 \u0938\u094D\u0935\u093E\u0917\u0924 \u0939\u0948",
            "auth.subtitle":      "\u0905\u092A\u0928\u0947 \u092A\u093E\u0932\u0924\u0942 \u091C\u093E\u0928\u0935\u0930\u094B\u0902 \u0915\u094B \u092A\u094D\u0930\u092C\u0902\u0927\u093F\u0924 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0932\u0949\u0917\u093F\u0928 \u0915\u0930\u0947\u0902",
            "auth.remember":      "\u0907\u0938 \u0921\u093F\u0935\u093E\u0907\u0938 \u092A\u0930 \u092E\u0941\u091D\u0947 \u092F\u093E\u0926 \u0930\u0916\u0947\u0902",
            "auth.create":        "\u0916\u093E\u0924\u093E \u092C\u0928\u093E\u090F\u0902 \u2192",
            "auth.mobileOrEmail": "\u092E\u094B\u092C\u093E\u0907\u0932 \u092F\u093E \u0908\u092E\u0947\u0932",
            "auth.password":      "\u092A\u093E\u0938\u0935\u0930\u094D\u0921",
            "field.fullName":     "\u092A\u0942\u0930\u093E \u0928\u093E\u092E *",
            "field.mobile":       "\u092E\u094B\u092C\u093E\u0907\u0932 *",
            "field.email":        "\u0908\u092E\u0947\u0932 *",
            "field.address":      "\u092A\u0924\u093E *",
            "field.city":         "\u0936\u0939\u0930 *",
            "field.nigam":        "\u0928\u0917\u0930 \u0928\u093F\u0917\u092E *",
            "field.zone":         "\u091C\u093C\u094B\u0928 *",
            "field.ward":         "\u0935\u093E\u0930\u094D\u0921 *",
            "pet.qrTitle":        "\u092A\u093E\u0932\u0924\u0942 \u0915\u094D\u092F\u0942\u0906\u0930 \u0915\u094B\u0921",
            "pet.qrSub":          "\u0905\u092A\u0928\u0947 \u092A\u093E\u0932\u0924\u0942 \u091C\u093E\u0928\u0935\u0930 \u0915\u0940 \u092A\u0939\u091A\u093E\u0928 \u0915\u0947 \u0932\u093F\u090F \u0938\u094D\u0915\u0948\u0928 \u0915\u0930\u0947\u0902",
            "pet.shareQR":        "\u0915\u094D\u092F\u0942\u0906\u0930 \u0915\u094B\u0921 \u0938\u093E\u091D\u093E \u0915\u0930\u0947\u0902",
            "pet.licenceValid":   "\u092E\u093E\u0928\u094D\u092F \u0924\u093F\u0925\u093F",
            "admin.overview":     "\u0905\u0935\u0932\u094B\u0915\u0928",
            "admin.pending":      "\u0932\u0902\u092C\u093F\u0924",
            "admin.approved":     "\u0938\u094D\u0935\u0940\u0915\u0943\u0924",
            "admin.analytics":    "\u0935\u093F\u0936\u094D\u0932\u0947\u0937\u0923",
            "lang.toggle":        "English",
        },
    };

    let _lang = "en";
    try { _lang = localStorage.getItem("afp_lang") || "en"; } catch { }
    if (!DICT[_lang]) _lang = "en";

    function t(key, fallback) {
        return (DICT[_lang] && DICT[_lang][key]) || (DICT.en && DICT.en[key]) || fallback || key;
    }

    function apply(root) {
        const scope = root || document;
        scope.querySelectorAll("[data-i18n]").forEach(el => {
            const key  = el.getAttribute("data-i18n");
            const attr = el.getAttribute("data-i18n-attr");
            const val  = t(key);
            if (attr) el.setAttribute(attr, val);
            else      el.textContent = val;
        });
        if (scope.documentElement) scope.documentElement.setAttribute("lang", _lang);
    }

    function setLang(lang) {
        if (!DICT[lang]) return;
        const changed = _lang !== lang;
        _lang = lang;
        try { localStorage.setItem("afp_lang", lang); } catch { }
        apply();
        const btn = document.getElementById("afp-lang-toggle");
        if (btn) btn.textContent = t("lang.toggle");
        // Most screens are rendered by JS from hard-coded strings (they don't use
        // data-i18n). A full reload is the pragmatic way to make the new language
        // take effect everywhere until every screen is migrated to I18n.t().
        if (changed) {
            try { window.location.reload(); } catch { }
        }
    }

    function toggle() { setLang(_lang === "en" ? "hi" : "en"); }
    function getLang() { return _lang; }

    // Auto-apply on DOM ready + inject a floating toggle button (top-right pill)
    document.addEventListener("DOMContentLoaded", () => {
        apply();
        if (!document.getElementById("afp-lang-toggle")) {
            const btn = document.createElement("button");
            btn.id = "afp-lang-toggle";
            btn.type = "button";
            btn.style.cssText =
                "position:fixed;top:8px;right:8px;z-index:10000;" +
                "background:#1A1814;color:#fff;border:none;border-radius:999px;" +
                "font-size:11px;font-weight:600;padding:5px 10px;cursor:pointer;" +
                "box-shadow:0 2px 6px rgba(0,0,0,.15);opacity:.85;";
            btn.textContent = t("lang.toggle");
            btn.onclick = toggle;
            document.body.appendChild(btn);
        }
    });

    return { t, apply, setLang, toggle, getLang };
})();
