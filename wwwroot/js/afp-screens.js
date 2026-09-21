// ?? afp-screens.js — Orchestrator ????????????????????????????????????????????
// Contains only the screens that don't belong to a dedicated module:
//   Dashboard, Profile, Search Pet, Pet Meter, Search Doctor, Search Shop.
// Auth screens  ? afp-auth.js
// Pet screens   ? afp-pets.js
// Admin screens ? afp-admin.js

// ?? SCREEN: SPLASH ????????????????????????????????????????????????????????????
// Static HTML; no JS initialization needed.

// ?? SCREEN: DASHBOARD ?????????????????????????????????????????????????????????
async function loadDashboard() {
    const user = AFP.getUser();
    if (!user) { AFP.go("splash"); return; }
    const body = document.getElementById("dashboard-body");
    renderLoading(body);
    generateNotifications();
    try {
        const pets     = await AFP.GET("/api/pets/my");
        const approved = pets.filter(p => p.registration_status === "approved");
        const pending  = pets.filter(p => p.registration_status === "pending");
        const vp       = pets.find(p => p.vaccine_next_due);
        const dv       = vp ? AFP.daysTo(vp.vaccine_next_due) : null;
        const firstName = (user.name || "User").split(" ")[0];

        let vaxBanner = "";
        if (dv !== null && dv <= 30) {
            vaxBanner = `
            <div class="vax-alert" onclick="openPet(${vp.id})">
                <span style="font-size:17px">&#x1F489;</span>
                <div style="flex:1">
                    <div style="font-weight:600;color:#92400E;font-size:13px">${escHtml(vp.name)} &mdash; Vaccine due in ${dv} days</div>
                    <div style="font-size:11px;color:#92400E;margin-top:1px">Tap to view</div>
                </div>
                <span style="color:#92400E">&#8250;</span>
            </div>`;
        }

        // ── Business listing renewal reminder ────────────────────────────
        // Shown to owners of any doctor / shop listing that expires in the
        // next 30 days (or has already lapsed). Fire-and-forget: any error
        // here should never block the dashboard from rendering.
        let renewalBanner = "";
        try {
            const listings = await AFP.GET("/api/business/my-listings");
            const due = (listings || []).filter(l => l.needs_renewal);
            if (due.length) {
                const l   = due[0];
                const dys = l.days_to_expiry;
                const msg = dys < 0
                    ? `${escHtml(l.name)} listing EXPIRED ${Math.abs(dys)} day${Math.abs(dys) === 1 ? "" : "s"} ago`
                    : dys === 0
                    ? `${escHtml(l.name)} listing expires TODAY`
                    : `${escHtml(l.name)} listing expires in ${dys} day${dys === 1 ? "" : "s"}`;
                const isUrgent = dys <= 7;
                renewalBanner = `
                <div class="vax-alert${isUrgent ? " vax-alert-danger" : ""}"
                     onclick="window.location.href='/RegisterBusiness'">
                    <span style="font-size:17px">${dys < 0 ? "&#x274C;" : "&#x23F0;"}</span>
                    <div style="flex:1">
                        <div style="font-weight:600;color:${isUrgent ? "var(--er)" : "#92400E"};font-size:13px">${msg}</div>
                        <div style="font-size:11px;color:${isUrgent ? "var(--er)" : "#92400E"};margin-top:1px">
                            Tap to renew${due.length > 1 ? ` (+${due.length - 1} more)` : ""}
                        </div>
                    </div>
                    <span style="color:${isUrgent ? "var(--er)" : "#92400E"}">&#8250;</span>
                </div>`;
            }
        } catch { /* no-op — user may have no business listings */ }


        const statsHTML = [
            ["&#x1F43E;", pets.length,     "My pets"],
            ["&#x2705;",  approved.length, "Licensed"],
            ["&#x23F3;",  pending.length,  "Pending"],
            ["&#x1F4C5;", dv !== null ? `${dv}d` : "&mdash;", "Vaccine"],
        ].map(([ic, v, l]) => `
            <div class="scard">
                <div class="scard-icon">${ic}</div>
                <div class="scard-val">${v}</div>
                <div class="scard-lbl">${l}</div>
            </div>`).join("");

        const petsHTML = pets.length === 0
            ? `<div class="card" style="text-align:center;padding:26px">
                    <div style="font-size:36px">&#x1F43E;</div>
                    <div style="font-weight:600;margin-top:10px;margin-bottom:6px">No pets yet</div>
                    <button class="btn btn-primary btn-small btn-w-auto" onclick="AFP.go('newPet')" style="padding:10px 20px">Register a Pet</button>
               </div>`
            : pets.slice(0, 3).map(p => petCardHTML(p, `openPet(${p.id})`)).join("");

        const isCitizen = ["citizen", "super_admin"].includes(user.role);
        const extraActions = isCitizen ? `
            <div class="fcard" onclick="AFP.go('searchDoctor')">
                <div class="fcard-icon" style="background:#EBF3FF">&#x1FA7A;</div>
                <div class="fcard-lbl">Find a vet</div>
            </div>
            <div class="fcard" onclick="AFP.go('searchShop')">
                <div class="fcard-icon" style="background:#F3E8FF">&#x1F6D2;</div>
                <div class="fcard-lbl">Pet food shops</div>
            </div>
            <div class="fcard" onclick="AFP.go('breedingMatch')">
                <div class="fcard-icon" style="background:#FDE8F0">&#x1F49E;</div>
                <div class="fcard-lbl">Breeding match</div>
            </div>
            <div class="fcard" onclick="AFP.go('forum')">
                <div class="fcard-icon" style="background:#E8F4FF">&#x1F4AC;</div>
                <div class="fcard-lbl">Community forum</div>
            </div>
            <div class="fcard" onclick="AFP.go('ratings')">
                <div class="fcard-icon" style="background:#FEF3C7">&#x2B50;</div>
                <div class="fcard-lbl">Ratings &amp; feedback</div>
            </div>
            <div class="fcard" onclick="AFP.go('vaxReminders')">
                <div class="fcard-icon" style="background:#FEF3C7">&#x1F489;</div>
                <div class="fcard-lbl">Vaccine reminders</div>
            </div>
            <div class="fcard" onclick="AFP.go('adoption')">
                <div class="fcard-icon" style="background:#D1FAE5">&#x1F43E;</div>
                <div class="fcard-lbl">Adopt a pet</div>
            </div>
            <div class="fcard" onclick="AFP.go('lostFound')">
                <div class="fcard-icon" style="background:#EBF3FF">&#x1F50D;</div>
                <div class="fcard-lbl">Lost &amp; found</div>
            </div>
            <div class="fcard" onclick="AFP.go('emergencyVet')">
                <div class="fcard-icon" style="background:#FEE2E2">&#x1F6A8;</div>
                <div class="fcard-lbl">Emergency vet</div>
            </div>
            <div class="fcard" onclick="AFP.go('microchip')">
                <div class="fcard-icon" style="background:#F3E8FF">&#x1F4F2;</div>
                <div class="fcard-lbl">Microchip lookup</div>
            </div>
            <div class="fcard" onclick="AFP.go('events')">
                <div class="fcard-icon" style="background:#FFF3E8">&#x1F4C5;</div>
                <div class="fcard-lbl">Pet events</div>
            </div>` : "";

        body.innerHTML = `
            <div class="p-18" style="padding-bottom:6px">
                <div class="cpill"><span class="cpill-tx">&#x1F4CD; ${escHtml(user.city_name || "City")}</span></div>
                <div style="font-size:21px;font-weight:700;margin-bottom:2px">Hello, ${escHtml(firstName)} &#x1F44B;</div>
                <div style="font-size:13px;color:var(--tx2)">Manage your registered pets</div>
            </div>
            ${vaxBanner}
            ${renewalBanner}
            <div class="sgrid">${statsHTML}</div>
            <div class="p-18" style="padding-top:0">
                <div class="sec-hdr">
                    <span class="sec-title">My pets</span>
                    <button class="sec-action" onclick="AFP.go('newPet')">+ Add pet</button>
                </div>
                ${petsHTML}
                <div style="margin-top:4px">
                    <div class="sec-title" style="margin-bottom:12px">Quick actions</div>
                    <div class="fgrid">
                        <div class="fcard" onclick="AFP.go('newPet')">
                            <div class="fcard-icon" style="background:#FFF3E8">&#x1F43E;</div>
                            <div class="fcard-lbl">Register new pet</div>
                        </div>
                        <div class="fcard" onclick="AFP.go('renew')">
                            <div class="fcard-icon" style="background:#D1FAE5">&#x1F504;</div>
                            <div class="fcard-lbl">Renew licence</div>
                        </div>
                        <div class="fcard" onclick="AFP.go('reportPet')">
                            <div class="fcard-icon" style="background:#FEF3C7">&#x26A0;&#xFE0F;</div>
                            <div class="fcard-lbl">Report a pet</div>
                        </div>
                        <div class="fcard" onclick="AFP.go('newOwner')">
                            <div class="fcard-icon" style="background:#FEE2E2">&#x1F501;</div>
                            <div class="fcard-lbl">Transfer pet</div>
                        </div>
                        <div class="fcard" onclick="AFP.go('petMeter')">
                            <div class="fcard-icon" style="background:#EBF3FF">&#x1F4CA;</div>
                            <div class="fcard-lbl">Pet census</div>
                        </div>
                        ${extraActions}
                    </div>
                </div>
            </div>`;
    } catch (ex) {
        AFP.tst("Error: " + ex.message);
        renderEmpty(body, "&#x26A0;&#xFE0F;", "Failed to load dashboard");
    }
}

// ?? SCREEN: SEARCH PET ????????????????????????????????????????????????????????
async function loadSearchPet() {
    const body = document.getElementById("search-body");
    if (!body) return;
    body.innerHTML = bottomNavHTML("search");
    await doSearchPet();
}

async function doSearchPet() {
    const q       = document.getElementById("searchpet-q")?.value || "";
    const flt     = document.querySelector(".searchpet-chip.active")?.dataset.flt || "all";
    const results = document.getElementById("search-results");
    if (!results) return;
    const user = AFP.getUser();
    renderLoading(results);
    try {
        let data = await AFP.GET(`/api/pets/search?q=${encodeURIComponent(q)}&cityId=${user?.city_id || ""}`);
        if (flt === "dog" || flt === "cat") data = data.filter(p => p.species === flt);
        else if (flt === "other")           data = data.filter(p => !["dog","cat"].includes(p.species));
        if (data.length === 0) { renderEmpty(results, "&#x1F50D;", q ? "No pets found" : "Search by name, owner or Pet ID"); return; }
        results.innerHTML = data.map(p => petCardHTML(p, `openPet(${p.id})`)).join("");
    } catch { renderEmpty(results, "&#x1F50D;", "Search by name, owner or Pet ID"); }
}

function setSearchFilter(el, flt) {
    document.querySelectorAll(".searchpet-chip").forEach(c => c.classList.remove("active"));
    el.classList.add("active");
    doSearchPet();
}

// ?? SCREEN: PET METER ?????????????????????????????????????????????????????????
async function loadPetMeter() {
    const body = document.getElementById("meter-body");
    if (!body) return;
    renderLoading(body);
    try {
        const stats    = await AFP.GET("/api/pets/stats");
        const maxTotal = Math.max(...(stats.cities || []).map(c => +c.total), 1);
        const citiesHTML = (stats.cities || []).map(c => `
            <div class="card">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                    <span style="font-weight:600;font-size:14px">&#x1F4CD; ${escHtml(c.name)}</span>
                    <span style="font-size:13px;color:var(--tx2)">${c.total} pets</span>
                </div>
                <div class="meter-bar">
                    <div class="meter-fill" style="width:${Math.min(100, +c.total / maxTotal * 100).toFixed(1)}%"></div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px">
                    <span class="badge badge-ok">\uD83D\uDC36 ${c.dogs   || 0}</span>
                    <span class="badge badge-in">\uD83D\uDC31 ${c.cats   || 0}</span>
                    <span class="badge badge-or">\uD83D\uDC30 ${c.others || 0}</span>
                </div>
            </div>`).join("");

        body.innerHTML = `
            <div style="padding:13px 13px 4px;font-size:13px;color:var(--tx2)">Live pet census across all cities</div>
            <div class="sgrid">
                <div class="scard"><div class="scard-icon">&#x1F3D9;&#xFE0F;</div><div class="scard-val">3</div><div class="scard-lbl">Cities</div></div>
                <div class="scard"><div class="scard-icon">&#x1F43E;</div><div class="scard-val">${stats.totalPets}</div><div class="scard-lbl">Total</div></div>
                <div class="scard"><div class="scard-icon">&#x2705;</div><div class="scard-val">${stats.activeLicences}</div><div class="scard-lbl">Licensed</div></div>
                <div class="scard"><div class="scard-icon">&#x23F3;</div><div class="scard-val">${stats.pendingCount}</div><div class="scard-lbl">Pending</div></div>
            </div>
            <div style="padding:0 18px">
                <div class="sec-title" style="margin-bottom:13px">By city</div>
                ${citiesHTML}
            </div>`;
    } catch (ex) {
        body.innerHTML = `<div class="p-18">${alertBoxHTML("err", "Failed to load pet meter data.")}</div>`;
    }
}

// ?? SCREEN: PROFILE ???????????????????????????????????????????????????????????
let _profileTab = "details";

async function loadProfile() {
    const user = AFP.getUser();
    if (!user) { AFP.go("splash"); return; }
    const nameEl = document.getElementById("profile-name");
    const idEl   = document.getElementById("profile-id");
    if (nameEl) nameEl.textContent = user.name || "";
    if (idEl)   idEl.textContent   = "AFP-USER-" + String(user.id || 0).padStart(4, "0");
    _profileTab = "details";
    document.querySelectorAll("#screen-profile .tab").forEach(t =>
        t.classList.toggle("active", t.dataset.tab === "details"));
    await renderProfileTab("details");
}

function profileSetTab(tab) {
    _profileTab = tab;
    document.querySelectorAll("#screen-profile .tab").forEach(t =>
        t.classList.toggle("active", t.dataset.tab === tab));
    renderProfileTab(tab);
}

async function renderProfileTab(tab) {
    const body = document.getElementById("profile-body");
    const user = AFP.getUser();
    if (!body || !user) return;

    if (tab === "details") {
        body.innerHTML = `
            <div class="card">
                ${infoRowHTML("Mobile",  user.mobile)}
                ${infoRowHTML("Email",   user.email)}
                ${infoRowHTML("Address", user.address)}
                ${infoRowHTML("Ward",    user.ward_number)}
                ${infoRowHTML("Nigam",   user.nigam_name)}
                ${infoRowHTML("City",    user.city_name)}
                <div style="margin-top:13px">
                    <button class="btn btn-danger" onclick="AFP.logout()">&#x1F6AA; Logout</button>
                </div>
            </div>`;
    } else if (tab === "pets") {
        renderLoading(body);
        try {
            const pets = await AFP.GET("/api/pets/my");
            body.innerHTML = pets.length === 0
                ? `<div class="center"><div class="center-icon">&#x1F43E;</div><div class="center-text">No pets registered yet</div></div>`
                : pets.map(p => petCardHTML(p, `openPet(${p.id})`)).join("");
            body.innerHTML += `<button class="btn btn-primary mt-8" onclick="AFP.go('newPet')">+ Register new pet</button>`;
        } catch { renderEmpty(body, "&#x26A0;&#xFE0F;", "Failed to load pets"); }
    } else if (tab === "docs") {
        renderLoading(body);
        try {
            const pets     = await AFP.GET("/api/pets/my");
            const approved = pets.filter(p => p.registration_status === "approved");
            if (approved.length === 0) {
                body.innerHTML = `<div class="center"><div class="center-icon">&#x1F4C4;</div>
                    <div class="center-text">No approved pets yet &mdash; documents unlock after ward approval</div></div>`;
                return;
            }
            body.innerHTML = approved.map(p => `
                <div class="card">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                        <div>
                            <div style="font-weight:600">${escHtml(p.name)} &mdash; Licence</div>
                            <div style="font-size:11px;color:var(--tx3);font-family:monospace">${escHtml(p.pet_id || "")}</div>
                        </div>
                        ${badgeHTML("PDF", "ok")}
                    </div>
                    <button class="btn btn-outline btn-small"
                        onclick="generateCertificateById(${p.id})">
                        &#x1F4DC; Download Certificate
                    </button>
                </div>`).join("");
        } catch { renderEmpty(body, "&#x26A0;&#xFE0F;", "Failed to load documents"); }
    }
}

// ?? SCREEN: SEARCH DOCTOR ?????????????????????????????????????????????????????
// State: default sort = "name" (A–Z alphabetical) to give a predictable list;
// citizens flip to "rating" via the Top-rated chip when they want the best first.
// Pagination: LIST_PAGE_SIZE rows per page, tracked by _docPage (0-based).
const LIST_PAGE_SIZE = 10;
let _docSort = "name";
let _docPage = 0;

async function loadSearchDoctor() {
    const user = AFP.getUser();
    if (!["citizen","super_admin"].includes(user?.role)) {
        document.getElementById("searchdoc-body").innerHTML = `
            <div class="center" style="flex:1">
                <div style="font-size:40px;margin-bottom:16px">&#x1F512;</div>
                <div style="font-size:16px;font-weight:600;margin-bottom:8px">Access Restricted</div>
                <div style="font-size:13px;color:var(--tx2);line-height:20px">Only citizens can access this feature.</div>
                <button class="btn btn-outline mt-8" style="width:160px"
                    onclick="AFP.go('dashboard')">&#x2190; Go back</button>
            </div>`;
        return;
    }
    _docPage = 0;
    _ensureSortChips("searchdoc-results", "doctor");
    await doSearchDoctor();
}

// Star display: filled ★ * n, empty ☆ * (5 - n). Half stars rounded to nearest.
function _starRow(avg, count) {
    if (!count || count === 0) {
        return `<span style="font-size:11px;color:var(--tx3);font-style:italic">New \u2014 no reviews yet</span>`;
    }
    const n = Math.round(Number(avg));
    const filled = "\u2605".repeat(Math.max(0, Math.min(5, n)));
    const empty  = "\u2606".repeat(5 - Math.max(0, Math.min(5, n)));
    const avgTxt = Number(avg).toFixed(1);
    return `
        <span style="color:#F5B301;font-size:13px;letter-spacing:1px" title="${avgTxt} of 5">
            ${filled}<span style="color:#D4D4D4">${empty}</span>
        </span>
        <span style="font-size:11px;color:var(--tx2);margin-left:5px">${avgTxt} (${count})</span>`;
}

// Inject the sort-chip row above a results container if it isn't already there.
// Default active chip is A–Z (matches the ordered directory behaviour citizens
// expect); the Top-rated chip is one tap away.
function _ensureSortChips(resultsId, kind) {
    const results = document.getElementById(resultsId);
    if (!results) return;
    const parent = results.parentElement;
    if (!parent || parent.querySelector(`.sortchips-${kind}`)) return;
    const wrap = document.createElement("div");
    wrap.className = `chips sortchips-${kind}`;
    wrap.style.margin = "0 0 10px";
    wrap.innerHTML = `
        <button class="chip"        data-sort="rating" onclick="_setListSort('${kind}','rating',this)">\u2B50 Top rated</button>
        <button class="chip active" data-sort="name"   onclick="_setListSort('${kind}','name',this)">A\u2013Z</button>`;
    parent.insertBefore(wrap, results);
}

function _setListSort(kind, sort, chipEl) {
    const chips = chipEl?.parentElement?.querySelectorAll(".chip");
    chips?.forEach(c => c.classList.toggle("active", c === chipEl));
    if (kind === "doctor") { _docSort = sort; _docPage = 0; doSearchDoctor(); }
    else                   { _shopSort = sort; _shopPage = 0; doSearchShop(); }
}

async function doSearchDoctor() {
    const q       = document.getElementById("searchdoc-q")?.value || "";
    // NOTE: the "All" chip has data-city="" — treat that as "no city filter".
    // We do NOT fall back to the logged-in user's city because citizens on
    // "All" explicitly want vets from every city.
    const cFlt    = document.querySelector(".searchdoc-chip.active")?.dataset.city || "";
    const results = document.getElementById("searchdoc-results");
    if (!results) return;
    renderLoading(results);
    try {
        const p = new URLSearchParams();
        if (cFlt) p.set("cityId", cFlt);
        if (q)    p.set("q", q);
        p.set("sortBy", _docSort);
        p.set("limit",  LIST_PAGE_SIZE);
        p.set("offset", _docPage * LIST_PAGE_SIZE);
        const data = await AFP.GET(`/api/doctors?${p}`);
        if (data.length === 0 && _docPage === 0) {
            renderEmpty(results, "&#x1FA7A;", "No vets found");
            return;
        }
        // If a stale page has no rows (user changed filters), reset to page 0.
        if (data.length === 0 && _docPage > 0) {
            _docPage = 0;
            return doSearchDoctor();
        }
        const cards = data.map(d => `
            <div class="dir-card" onclick="openDoctorModal(${d.id})">
                <div class="dir-card-avatar" style="background:var(--bl-p)">&#x1F468;&#x200D;&#x2695;&#xFE0F;</div>
                <div style="flex:1">
                    <div style="font-weight:600;font-size:14px;margin-bottom:2px">${escHtml(d.name)}</div>
                    <div style="font-size:12px;color:var(--tx2);margin-bottom:2px">${escHtml(d.specialization || "")}</div>
                    <div style="font-size:11px;color:var(--tx3)">&#x1F4CD; ${escHtml(d.ward_number || "")}, ${escHtml(d.city_name || "")}</div>
                    <div style="margin-top:5px;cursor:pointer" onclick="event.stopPropagation();openReviewsModal('doctor',${d.id},'${escHtml((d.name || '').replace(/'/g,"\\'"))}')">
                        ${_starRow(d.average_rating, d.rating_count)}
                    </div>
                    <div style="margin-top:5px">
                        ${badgeHTML(d.is_24hr ? "24hr Clinic" : "Available", d.is_24hr ? "in" : "ok")}
                    </div>
                </div>
            </div>`).join("");
        results.innerHTML = cards + _paginationHTML("doctor", _docPage, data.length);
        results._doctors = data;
    } catch { renderEmpty(results, "&#x1FA7A;", "No vets found"); }
}

function setDoctorFilter(el, city) {
    document.querySelectorAll(".searchdoc-chip").forEach(c => c.classList.remove("active"));
    el.classList.add("active");
    _docPage = 0;
    doSearchDoctor();
}

function openDoctorModal(id) {
    const results = document.getElementById("searchdoc-results");
    const d = (results?._doctors || []).find(x => x.id === id);
    if (!d) return;
    document.getElementById("docmodal-name").textContent = d.name;
    document.getElementById("docmodal-qual").textContent = d.qualification || "";
    document.getElementById("docmodal-details").innerHTML = `
        ${infoRowHTML("Clinic",         d.clinic_name)}
        ${infoRowHTML("Address",        d.address)}
        ${infoRowHTML("City",           d.city_name)}
        ${infoRowHTML("Timings",        d.timings)}
        ${infoRowHTML("Specialization", d.specialization)}
        ${infoRowHTML("Mobile",         d.mobile)}`;
    document.getElementById("docmodal-call").onclick = () => {
        AFP.tst(`Calling ${d.name}...`);
        closeDoctorModal();
    };
    document.getElementById("doc-modal").style.display = "flex";
}

function closeDoctorModal() {
    document.getElementById("doc-modal").style.display = "none";
}

// ?? SCREEN: SEARCH SHOP ???????????????????????????????????????????????????????
// Same defaults as the vet screen: A–Z sort, one-tap flip to Top rated,
// LIST_PAGE_SIZE rows per page.
let _shopSort = "name";
let _shopPage = 0;

async function loadSearchShop() {
    _shopPage = 0;
    _ensureSortChips("searchshop-results", "shop");
    await doSearchShop();
}

async function doSearchShop() {
    const q       = document.getElementById("searchshop-q")?.value || "";
    // "All" chip => no city filter; do not silently narrow to home city.
    const cFlt    = document.querySelector(".searchshop-chip.active")?.dataset.city || "";
    const results = document.getElementById("searchshop-results");
    if (!results) return;
    renderLoading(results);
    try {
        const p = new URLSearchParams();
        if (cFlt) p.set("cityId", cFlt);
        if (q)    p.set("q", q);
        p.set("sortBy", _shopSort);
        p.set("limit",  LIST_PAGE_SIZE);
        p.set("offset", _shopPage * LIST_PAGE_SIZE);
        const data = await AFP.GET(`/api/shops?${p}`);
        if (data.length === 0 && _shopPage === 0) {
            renderEmpty(results, "&#x1F6D2;", "No shops found");
            return;
        }
        if (data.length === 0 && _shopPage > 0) {
            _shopPage = 0;
            return doSearchShop();
        }
        const cards = data.map(s => `
            <div class="dir-card" onclick="openShopModal(${s.id})">
                <div class="dir-card-avatar" style="background:#F3E8FF">&#x1F6D2;</div>
                <div style="flex:1">
                    <div style="font-weight:600;font-size:14px;margin-bottom:2px">${escHtml(s.name)}</div>
                    <div style="font-size:12px;color:var(--tx2);margin-bottom:2px">${escHtml(s.speciality || "")}</div>
                    <div style="font-size:11px;color:var(--tx3)">&#x1F4CD; ${escHtml(s.ward_number || "")}, ${escHtml(s.city_name || "")}</div>
                    <div style="margin-top:5px;cursor:pointer" onclick="event.stopPropagation();openReviewsModal('shop',${s.id},'${escHtml((s.name || '').replace(/'/g,"\\'"))}')">
                        ${_starRow(s.average_rating, s.rating_count)}
                    </div>
                    <div style="margin-top:5px">${badgeHTML("Open", "ok")}</div>
                </div>
            </div>`).join("");
        results.innerHTML = cards + _paginationHTML("shop", _shopPage, data.length);
        results._shops = data;
    } catch { renderEmpty(results, "&#x1F6D2;", "No shops found"); }
}

// ?? Pagination footer ???????????????????????????????????????????????????????
// Rendered as the last child of the results container. Prev is disabled on
// page 0; Next is disabled when the last fetch returned fewer than
// LIST_PAGE_SIZE rows (i.e. we've reached the end).
function _paginationHTML(kind, page, gotCount) {
    const hasPrev = page > 0;
    const hasNext = gotCount >= LIST_PAGE_SIZE;
    if (!hasPrev && !hasNext) return "";  // single-page list — hide entirely
    const disabledStyle = "opacity:.4;cursor:not-allowed";
    return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;padding:8px 4px">
            <button class="btn btn-ghost btn-small btn-w-auto"
                    style="padding:8px 14px;${hasPrev ? "" : disabledStyle}"
                    ${hasPrev ? "" : "disabled"}
                    onclick="_gotoPage('${kind}',${page - 1})">&larr; Prev</button>
            <div style="font-size:12px;color:var(--tx3)">Page ${page + 1}</div>
            <button class="btn btn-ghost btn-small btn-w-auto"
                    style="padding:8px 14px;${hasNext ? "" : disabledStyle}"
                    ${hasNext ? "" : "disabled"}
                    onclick="_gotoPage('${kind}',${page + 1})">Next &rarr;</button>
        </div>`;
}

function _gotoPage(kind, page) {
    if (kind === "doctor") { _docPage  = Math.max(0, page); doSearchDoctor(); }
    else                   { _shopPage = Math.max(0, page); doSearchShop();  }
    window.scrollTo(0, 0);
}

function setShopFilter(el, city) {
    document.querySelectorAll(".searchshop-chip").forEach(c => c.classList.remove("active"));
    el.classList.add("active");
    _shopPage = 0;
    doSearchShop();
}

function openShopModal(id) {
    const results = document.getElementById("searchshop-results");
    const s = (results?._shops || []).find(x => x.id === id);
    if (!s) return;
    document.getElementById("shopmodal-name").textContent  = s.name;
    document.getElementById("shopmodal-owner").textContent = `Owner: ${s.owner_name || ""}`;
    document.getElementById("shopmodal-details").innerHTML = `
        ${infoRowHTML("Address",    s.address)}
        ${infoRowHTML("City",       s.city_name)}
        ${infoRowHTML("Timings",    s.timings)}
        ${infoRowHTML("Speciality", s.speciality)}
        ${infoRowHTML("Mobile",     s.mobile)}`;
    document.getElementById("shopmodal-call").onclick = () => {
        AFP.tst(`Calling ${s.name}...`);
        closeShopModal();
    };
    document.getElementById("shop-modal").style.display = "flex";
}

function closeShopModal() {
    document.getElementById("shop-modal").style.display = "none";
}

// ?? REVIEWS MODAL (tap the stars on a vet/shop card) ??????????????????????????
// Lazily creates a shared modal shell the first time it's opened, then loads
// `/api/ratings/for/:type/:id` and renders the summary + review list. Public
// endpoint — works for logged-in citizens AND unauthenticated visitors on the
// SEO-indexed /vets and /shops pages.
function _ensureReviewsModal() {
    let m = document.getElementById("reviews-modal");
    if (m) return m;
    const shell = document.createElement("div");
    shell.innerHTML = `
        <div id="reviews-modal" class="modal-bg" style="display:none">
            <div class="modal-sheet">
                <div class="modal-handle"></div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px">
                    <div id="reviews-modal-title" style="font-size:16px;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">&#x2B50; Reviews</div>
                    <button style="background:none;border:none;font-size:20px;color:var(--tx3);cursor:pointer;line-height:1"
                        onclick="closeReviewsModal()">&times;</button>
                </div>
                <div id="reviews-modal-summary" style="margin-bottom:12px"></div>
                <div id="reviews-modal-body" class="scroll" style="max-height:60vh;overflow-y:auto;padding-right:4px"></div>
                <button class="btn btn-ghost mt-8" onclick="closeReviewsModal()">Close</button>
            </div>
        </div>`;
    document.body.appendChild(shell.firstElementChild);
    m = document.getElementById("reviews-modal");
    // Backdrop-click to close
    m.addEventListener("click", e => { if (e.target === m) closeReviewsModal(); });
    return m;
}

async function openReviewsModal(type, id, targetName) {
    const m = _ensureReviewsModal();
    document.getElementById("reviews-modal-title").textContent =
        `\u2B50 ${targetName || "Reviews"}`;
    const summary = document.getElementById("reviews-modal-summary");
    const body    = document.getElementById("reviews-modal-body");
    summary.innerHTML = "";
    renderLoading(body);
    m.style.display = "flex";
    try {
        // The public reviews endpoint doesn't need auth, but we hit it via
        // fetch() directly so it works from both citizen and public contexts.
        const res  = await fetch(`/api/ratings/for/${encodeURIComponent(type)}/${id}?limit=50`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load reviews.");
        const s = data.summary || { rating_count: 0, average_rating: 0 };
        summary.innerHTML = `
            <div class="scard" style="text-align:center">
                <div style="font-size:24px;font-weight:700;color:var(--or)">
                    ${Number(s.average_rating || 0).toFixed(1)}&nbsp;<span style="font-size:18px">\u2B50</span>
                </div>
                <div style="font-size:11px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">
                    ${s.rating_count || 0} review${s.rating_count === 1 ? "" : "s"}
                </div>
            </div>`;
        const rows = data.rows || [];
        if (rows.length === 0) {
            renderEmpty(body, "\u2B50", "Be the first to leave a review!");
            return;
        }
        body.innerHTML = rows.map(r => {
            const stars = "\u2605".repeat(r.stars) + "\u2606".repeat(5 - r.stars);
            const when  = new Date(r.updated_at || r.created_at).toLocaleDateString("en-IN",
                { day: "2-digit", month: "short", year: "numeric" });
            return `
            <div class="card" style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">
                    <div style="font-size:13px;font-weight:600">${escHtml(r.reviewer_name)}</div>
                    <span style="color:#F5B301;font-size:13px;letter-spacing:1px" title="${r.stars} of 5">${stars}</span>
                </div>
                <div style="font-size:11px;color:var(--tx3);margin-bottom:${r.comment ? 6 : 0}px">${escHtml(when)}</div>
                ${r.comment ? `<div style="font-size:13px;line-height:1.5;color:var(--tx);white-space:pre-wrap">${escHtml(r.comment)}</div>` : ""}
            </div>`;
        }).join("");
    } catch (ex) {
        body.innerHTML = alertBoxHTML("err", "Failed to load reviews: " + ex.message);
    }
}

function closeReviewsModal() {
    const m = document.getElementById("reviews-modal");
    if (m) m.style.display = "none";
}

// ?? PAGE INIT ?????????????????????????????????????????????????????????????????
document.addEventListener("DOMContentLoaded", function () {
    const user  = AFP.getUser();
    const token = AFP.getToken();

    initLogin();
    initRegister();
    initAdminLogin();
    initNewPet();
    initReportPet();

    if (user && token) {
        AFP.go(user.role === "citizen" ? "dashboard" : "admin");
    } else {
        AFP.go("splash");
    }

    // Close modals when clicking backdrop
    document.querySelectorAll(".modal-bg").forEach(bg => {
        bg.addEventListener("click", function (e) {
            if (e.target === this) this.style.display = "none";
        });
    });
});
