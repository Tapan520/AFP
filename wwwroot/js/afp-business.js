// ── AFP Business (Vet / Shop) landing screens ─────────────────────────────
// Handles routing + rendering for citizen accounts that are actually
// veterinary / pet-shop applicants (linked via business_applications).
//
// Uses two backend endpoints already provided by railway-backend/routes/business.js:
//   GET /api/business/mine         — application rows for the caller
//   GET /api/business/my-listings  — published doctor/shop rows with expiry
//
// Exposed globals:
//   routeAfterLogin(user)   — replaces the "citizen ? dashboard : admin" pick
//   loadAppStatus()         — screen loader for pending/rejected applications
//   loadVetHome()           — screen loader for approved doctor listings
//   loadShopHome()          — screen loader for approved shop listings

const BusinessHome = (() => {
    // Cache the /mine result across screen navigations so bnav taps are snappy.
    let _mine = null;
    let _listings = null;

    async function _fetchMine(force) {
        if (_mine && !force) return _mine;
        try { _mine = await AFP.GET("/api/business/mine"); }
        catch { _mine = []; }
        return _mine;
    }
    async function _fetchListings(force) {
        if (_listings && !force) return _listings;
        try { _listings = await AFP.GET("/api/business/my-listings"); }
        catch { _listings = []; }
        return _listings;
    }
    function invalidate() { _mine = null; _listings = null; }

    // Latest application wins — server returns newest-first already.
    function latestOfType(type) {
        if (!Array.isArray(_mine)) return null;
        return _mine.find(a => a.type === type) || null;
    }

    async function detect() {
        const apps = await _fetchMine();
        if (!apps || !apps.length) return { screen: "dashboard" };
        // Prefer an approved application; else fall back to the newest row.
        const approved = apps.find(a => a.status === "approved");
        const target   = approved || apps[0];
        if (target.status === "approved") {
            return { screen: target.type === "doctor" ? "vetHome" : "shopHome" };
        }
        return { screen: "appStatus" };
    }

    return { detect, invalidate, latestOfType, _fetchMine, _fetchListings,
             _cachedMine: () => _mine };
})();

// ── Which type of business is the current user? Used by the shared back
// button on preview/manage/renew screens to pick the right home.
function _currentBusinessType() {
    const apps = BusinessHome._cachedMine ? (BusinessHome._cachedMine() || []) : [];
    const approved = apps.find(a => a.status === "approved");
    return (approved || apps[0] || {}).type || "doctor";
}

function businessBackHome() {
    AFP.go(_currentBusinessType() === "shop" ? "shopHome" : "vetHome");
}

// ── Post-login router ─────────────────────────────────────────────────────
async function routeAfterLogin(user) {
    // Admins always go to the municipal admin screen.
    if (user && user.role && user.role !== "citizen") { AFP.go("admin"); return; }
    // Citizens might actually be vets/shops — check business applications.
    try {
        const { screen } = await BusinessHome.detect();
        AFP.go(screen);
    } catch { AFP.go("dashboard"); }
}

// ── Shared bits ───────────────────────────────────────────────────────────
function _statusPill(status) {
    const map = {
        draft:         { label: "Draft",          klass: "pn" },
        docs_uploaded: { label: "Docs uploaded",  klass: "in" },
        paid:          { label: "Payment received", klass: "in" },
        approved:      { label: "Approved",       klass: "ok" },
        rejected:      { label: "Rejected",       klass: "rj" },
        expired:       { label: "Expired",        klass: "rj" },
    };
    const m = map[status] || { label: status || "Unknown", klass: "pn" };
    return badgeHTML(m.label, m.klass);
}

function _expiryChip(days) {
    if (days == null || Number.isNaN(days)) return "";
    if (days < 0)  return badgeHTML(`Expired ${Math.abs(days)}d ago`, "rj");
    if (days <= 7) return badgeHTML(`Expires in ${days} day${days === 1 ? "" : "s"}`, "rj");
    if (days <= 30) return badgeHTML(`Renew in ${days} days`, "pn");
    return badgeHTML(`Valid ${days} more days`, "ok");
}

// ── SCREEN: Application Status ────────────────────────────────────────────
// Back button: return to the vet/shop home if the user has an approved
// listing; otherwise (e.g. still pending) fall back to splash so they can log
// out cleanly. Exposed globally for the inline onclick= in _BusinessMain.cshtml.
function appStatusBack() {
    const apps = Array.isArray(BusinessHome._cachedMine ? BusinessHome._cachedMine() : null)
        ? BusinessHome._cachedMine()
        : null;
    // Prefer an approved application to decide which home to land on.
    const approved = (apps || []).find(a => a.status === "approved");
    if (approved) {
        AFP.go(approved.type === "doctor" ? "vetHome" : "shopHome");
        return;
    }
    // No approved listing yet — go to the public splash rather than the
    // pet-owner dashboard which would be equally out of context.
    AFP.go("splash");
}

async function loadAppStatus() {
    const body = document.getElementById("appstatus-body");
    if (!body) return;
    renderLoading(body);
    const apps = await BusinessHome._fetchMine(true);
    if (!apps || !apps.length) {
        renderEmpty(body, "&#x1FA7A;",
            "No vet or shop application found on your account. If you meant to sign up as a pet owner, go to Home.");
        body.insertAdjacentHTML("beforeend",
            `<div style="text-align:center;margin-top:12px">
                <button class="btn btn-primary btn-w-auto" style="padding:10px 18px"
                        onclick="AFP.go('dashboard')">Go to Pet Owner Dashboard</button>
             </div>`);
        return;
    }

    body.innerHTML = apps.map(a => {
        const typeLabel = a.type === "doctor" ? "Veterinary listing" : "Pet-shop listing";
        const rejected  = a.status === "rejected";
        const canPay    = ["draft", "docs_uploaded"].includes(a.status);
        return `
        <div class="card" style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">
                <div>
                    <div style="font-weight:700;font-size:15px">${escHtml(a.name || typeLabel)}</div>
                    <div style="font-size:11px;color:var(--tx3);margin-top:2px">${typeLabel} &middot; Applied ${AFP.fmt(a.created_at)}</div>
                </div>
                ${_statusPill(a.status)}
            </div>
            <div style="background:var(--sf2);border-radius:8px;padding:9px;margin-bottom:10px;font-size:12px;color:var(--tx2)">
                ${a.type === "doctor" ? `
                    ${a.clinic_name    ? `Clinic: ${escHtml(a.clinic_name)}<br>` : ""}
                    ${a.specialization ? `Specialization: ${escHtml(a.specialization)}<br>` : ""}
                    ${a.qualification  ? `Qualification: ${escHtml(a.qualification)}<br>` : ""}
                ` : `
                    ${a.speciality ? `Speciality: ${escHtml(a.speciality)}<br>` : ""}
                    ${a.owner_name ? `Owner: ${escHtml(a.owner_name)}<br>` : ""}
                `}
                ${a.mobile ? `Mobile: ${escHtml(a.mobile)}` : ""}
            </div>
            ${rejected && a.reject_reason ? alertBoxHTML("err", `Reason: ${escHtml(a.reject_reason)}`) : ""}
            ${a.status === "paid" ? alertBoxHTML("info", "Your payment was received. Super Admin is reviewing your documents \u2014 you'll get an email when a decision is made.") : ""}
            ${a.status === "docs_uploaded" ? alertBoxHTML("warn", "Documents uploaded. Please complete the registration payment to enter the review queue.") : ""}
            ${a.status === "draft" ? alertBoxHTML("warn", "Upload your verification document and complete payment to submit for review.") : ""}
            <div class="d-row">
                ${canPay ? `<button class="btn btn-primary btn-small" onclick="window.location.href='/RegisterBusiness'">Continue application &#x2192;</button>` : ""}
                ${rejected ? `<button class="btn btn-outline btn-small" onclick="window.location.href='/RegisterBusiness'">Re-apply</button>` : ""}
            </div>
        </div>`;
    }).join("");
}

// ── Renew CTA ─────────────────────────────────────────────────────────────
function _renewBanner(listing) {
    if (!listing) return "";
    const d = Number(listing.days_to_expiry);
    if (d > 30) return "";
    const overdue = d < 0;
    return alertBoxHTML(overdue ? "err" : "warn",
        `Your listing ${overdue ? "expired" : "expires"} ${overdue ? Math.abs(d) + " day(s) ago" : "in " + d + " day(s)"}. Renew now to stay visible in citizen search.`)
        + `<button class="btn btn-primary" style="margin-bottom:14px"
                  onclick="AFP.go('renewListing')">
                &#x1F504; Renew listing
           </button>`;
}

// ── SCREEN: Vet Home ──────────────────────────────────────────────────────
async function loadVetHome() {
    const body = document.getElementById("vethome-body");
    if (!body) return;
    renderLoading(body);
    await BusinessHome._fetchMine();
    const listings = await BusinessHome._fetchListings();
    const app      = BusinessHome.latestOfType("doctor");
    const listing  = (listings || []).find(l => l.type === "doctor") || null;
    const user     = AFP.getUser();
    const firstName = escHtml((user?.name || "").split(" ")[0] || "");
    // Avoid "Dr. Dr Smith" when the user already registered as "Dr Smith".
    const hasDrPrefix = /^dr\.?$/i.test((user?.name || "").split(" ")[0] || "");
    const greet    = firstName ? (hasDrPrefix ? escHtml(user.name) : `Dr. ${firstName}`) : "Doctor";

    body.innerHTML = `
    <div style="padding:16px 15px 6px">
        <div style="font-size:12px;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px">Welcome back</div>
        <div style="font-size:22px;font-weight:700;margin-top:2px">${greet}</div>
        <div style="margin-top:4px">${badgeHTML("Registered Vet", "or")}</div>
    </div>
    <div style="padding:0 15px">
        ${_renewBanner(listing)}

        <div class="card" style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-weight:700">&#x1FA7A; ${escHtml(app?.clinic_name || app?.name || "Your Clinic")}</div>
                ${_expiryChip(listing?.days_to_expiry)}
            </div>
            <div style="font-size:12px;color:var(--tx2);line-height:1.6">
                ${app?.qualification  ? `Qualification: ${escHtml(app.qualification)}<br>`  : ""}
                ${app?.specialization ? `Specialization: ${escHtml(app.specialization)}<br>` : ""}
                ${app?.timings        ? `Timings: ${escHtml(app.timings)}<br>` : ""}
                ${app?.address        ? `Address: ${escHtml(app.address)}` : ""}
            </div>
        </div>

        <div style="display:flex;gap:9px;margin-bottom:12px">
            <div class="scard" style="flex:1">
                <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Profile views</div>
                <div style="font-size:22px;font-weight:700">&mdash;</div>
            </div>
            <div class="scard" style="flex:1">
                <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Calls this month</div>
                <div style="font-size:22px;font-weight:700">&mdash;</div>
            </div>
        </div>

        <div class="sec-title" style="margin-bottom:10px">Quick actions</div>
        <div class="card" style="margin-bottom:10px;cursor:pointer" onclick="AFP.go('listingPreview')">
            <div style="font-weight:600">&#x1F6CD;&#xFE0F; Preview my public listing</div>
            <div style="font-size:12px;color:var(--tx2);margin-top:2px">See exactly how pet owners find your clinic in the directory.</div>
        </div>
        <div class="card" style="margin-bottom:10px;cursor:pointer" onclick="AFP.go('manageListing')">
            <div style="font-weight:600">&#x1F464; Manage listing</div>
            <div style="font-size:12px;color:var(--tx2);margin-top:2px">Review the clinic details on file. Editing is coming soon.</div>
        </div>
        <div class="card" style="margin-bottom:14px;cursor:pointer" onclick="AFP.go('renewListing')">
            <div style="font-weight:600">&#x1F504; Renew listing</div>
            <div style="font-size:12px;color:var(--tx2);margin-top:2px">Pay the yearly platform fee to extend your listing expiry.</div>
        </div>
    </div>`;
}

// ── SCREEN: Shop Home ─────────────────────────────────────────────────────
async function loadShopHome() {
    const body = document.getElementById("shophome-body");
    if (!body) return;
    renderLoading(body);
    await BusinessHome._fetchMine();
    const listings = await BusinessHome._fetchListings();
    const app      = BusinessHome.latestOfType("shop");
    const listing  = (listings || []).find(l => l.type === "shop") || null;
    const user     = AFP.getUser();
    const greet    = escHtml((user?.name || "").split(" ")[0] || "there");

    body.innerHTML = `
    <div style="padding:16px 15px 6px">
        <div style="font-size:12px;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px">Welcome back</div>
        <div style="font-size:22px;font-weight:700;margin-top:2px">${greet}</div>
        <div style="margin-top:4px">${badgeHTML("Verified Shop", "or")}</div>
    </div>
    <div style="padding:0 15px">
        ${_renewBanner(listing)}

        <div class="card" style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-weight:700">&#x1F6D2; ${escHtml(app?.name || "Your Shop")}</div>
                ${_expiryChip(listing?.days_to_expiry)}
            </div>
            <div style="font-size:12px;color:var(--tx2);line-height:1.6">
                ${app?.speciality ? `Speciality: ${escHtml(app.speciality)}<br>` : ""}
                ${app?.owner_name ? `Owner: ${escHtml(app.owner_name)}<br>` : ""}
                ${app?.timings    ? `Timings: ${escHtml(app.timings)}<br>` : ""}
                ${app?.address    ? `Address: ${escHtml(app.address)}` : ""}
            </div>
        </div>

        <div style="display:flex;gap:9px;margin-bottom:12px">
            <div class="scard" style="flex:1">
                <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Profile views</div>
                <div style="font-size:22px;font-weight:700">&mdash;</div>
            </div>
            <div class="scard" style="flex:1">
                <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Tap to call</div>
                <div style="font-size:22px;font-weight:700">&mdash;</div>
            </div>
        </div>

        <div class="sec-title" style="margin-bottom:10px">Quick actions</div>
        <div class="card" style="margin-bottom:10px;cursor:pointer" onclick="AFP.go('listingPreview')">
            <div style="font-weight:600">&#x1F6CD;&#xFE0F; Preview my public listing</div>
            <div style="font-size:12px;color:var(--tx2);margin-top:2px">See exactly how pet owners find your shop in the directory.</div>
        </div>
        <div class="card" style="margin-bottom:10px;cursor:pointer" onclick="AFP.go('manageListing')">
            <div style="font-weight:600">&#x1F464; Manage listing</div>
            <div style="font-size:12px;color:var(--tx2);margin-top:2px">Review the shop details on file. Editing is coming soon.</div>
        </div>
        <div class="card" style="margin-bottom:14px;cursor:pointer" onclick="AFP.go('renewListing')">
            <div style="font-weight:600">&#x1F504; Renew listing</div>
            <div style="font-size:12px;color:var(--tx2);margin-top:2px">Pay the yearly platform fee to extend your listing expiry.</div>
        </div>
    </div>`;
}


// End of module.

// ── SCREEN: Public Listing Preview (in-app) ────────────────────────────────
// Renders the same public-facing directory card that pet owners see, without
// leaving the SPA shell. Reads from /api/business/mine (application) and
// /api/business/my-listings (published expiry).
async function loadListingPreview() {
    const body = document.getElementById("listing-preview-body");
    if (!body) return;
    renderLoading(body);
    await BusinessHome._fetchMine();
    await BusinessHome._fetchListings();
    const type    = _currentBusinessType();
    const app     = BusinessHome.latestOfType(type);
    const listing = (BusinessHome._fetchListings ? await BusinessHome._fetchListings() : []).find(l => l.type === type) || null;

    if (!app || app.status !== "approved") {
        renderEmpty(body, "&#x1F6CD;&#xFE0F;",
            "Your listing isn't public yet. Once approved by Super Admin it will appear in the directory here.");
        return;
    }

    const icon    = type === "doctor" ? "&#x1FA7A;" : "&#x1F6D2;";
    const heading = type === "doctor"
        ? (app.clinic_name || app.name || "Your Clinic")
        : (app.name || "Your Shop");
    const sub     = type === "doctor"
        ? [app.qualification, app.specialization].filter(Boolean).map(escHtml).join(" &middot; ")
        : [app.speciality].filter(Boolean).map(escHtml).join(" &middot; ");
    const cityLine = [app.ward_number ? `Ward ${app.ward_number}` : null, app.nigam_name, app.city_name]
        .filter(Boolean).map(escHtml).join(" &middot; ");

    body.innerHTML = `
        ${alertBoxHTML("info", "This is exactly how pet owners see your listing in the public directory.")}

        <div class="card" style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
                <div style="font-size:17px;font-weight:700">${icon} ${escHtml(heading)}</div>
                ${_expiryChip(listing?.days_to_expiry) || badgeHTML("Listed", "ok")}
            </div>
            ${sub ? `<div style="font-size:12px;color:var(--tx2);margin-bottom:10px">${sub}</div>` : ""}
            <div style="background:var(--sf2);border-radius:8px;padding:10px;font-size:13px;line-height:1.7;color:var(--tx)">
                ${app.address ? `&#x1F4CD; ${escHtml(app.address)}<br>` : ""}
                ${cityLine   ? `${cityLine}<br>` : ""}
                ${app.timings ? `&#x1F552; ${escHtml(app.timings)}<br>` : ""}
                ${app.mobile  ? `&#x1F4DE; <a href="tel:${escHtml(app.mobile)}" style="color:var(--or);text-decoration:none">${escHtml(app.mobile)}</a>` : ""}
            </div>
        </div>`;
}

// ── SCREEN: Manage Listing (in-app) ────────────────────────────────────────
// Read-only detail view. When PATCH /api/business/me is built we'll swap in
// an inline form here; the topbar & shell stay the same.
async function loadManageListing() {
    const body = document.getElementById("manage-listing-body");
    if (!body) return;
    renderLoading(body);
    await BusinessHome._fetchMine();
    const type = _currentBusinessType();
    const app  = BusinessHome.latestOfType(type);

    if (!app) {
        renderEmpty(body, "&#x1F464;", "No listing details on file yet.");
        return;
    }

    const rows = [];
    const push = (label, value) => {
        if (value == null || value === "") return;
        rows.push(`<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--bd);font-size:13px">
                     <span style="color:var(--tx2)">${escHtml(label)}</span>
                     <span style="font-weight:600;text-align:right">${escHtml(String(value))}</span>
                   </div>`);
    };
    push("Name",           app.name);
    if (type === "doctor") {
        push("Clinic",         app.clinic_name);
        push("Qualification",  app.qualification);
        push("Specialization", app.specialization);
    } else {
        push("Owner",          app.owner_name);
        push("Speciality",     app.speciality);
    }
    push("Mobile",   app.mobile);
    push("Timings",  app.timings);
    push("Address",  app.address);
    push("City",     app.city_name);
    push("Nigam",    app.nigam_name);
    push("Ward",     app.ward_number);
    push("Licence #",app.licence_no);
    push("Status",   (app.status || "").replace("_", " "));
    push("Applied",  AFP.fmt(app.created_at));

    body.innerHTML = `
        ${alertBoxHTML("warn", "Editing your listing details in-app is coming soon. To change any of the fields below, email <a href='mailto:support@allforpets.in' style='color:#92400E;font-weight:600'>support@allforpets.in</a> from your registered address.")}
        <div class="card" style="margin-bottom:14px">
            ${rows.join("")}
        </div>`;
}

// ── SCREEN: Renew Listing (in-app) ─────────────────────────────────────────
async function loadRenewListing() {
    const body = document.getElementById("renew-listing-body");
    if (!body) return;
    renderLoading(body);
    await BusinessHome._fetchMine();
    const listings = await BusinessHome._fetchListings();
    const type     = _currentBusinessType();
    const listing  = (listings || []).find(l => l.type === type) || null;
    const app      = BusinessHome.latestOfType(type);
    const heading  = (type === "doctor" ? (app?.clinic_name || app?.name) : app?.name) || "Your listing";

    body.innerHTML = `
        <div class="card" style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
                <div style="font-weight:700;font-size:15px">&#x1F504; ${escHtml(heading)}</div>
                ${_expiryChip(listing?.days_to_expiry)}
            </div>
            <div style="font-size:12px;color:var(--tx2);line-height:1.6">
                Extending your listing by 1 year keeps your ${type === "doctor" ? "clinic" : "shop"} visible in the public directory and search results.
            </div>
        </div>

        ${alertBoxHTML("info", "Online renewal is not available yet. To renew your listing, please email <a href='mailto:support@allforpets.in' style='color:#1E40AF;font-weight:600'>support@allforpets.in</a> with your registered mobile number \u2014 we'll extend the licence within 1\u20132 working days.")}

        <button class="btn btn-outline" style="width:100%;margin-top:6px"
                onclick="businessBackHome()">&#x2190; Back to my portal</button>`;
}
