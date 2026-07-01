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
    await doSearchDoctor();
}

async function doSearchDoctor() {
    const q       = document.getElementById("searchdoc-q")?.value || "";
    const cFlt    = document.querySelector(".searchdoc-chip.active")?.dataset.city || "";
    const user    = AFP.getUser();
    const results = document.getElementById("searchdoc-results");
    if (!results) return;
    renderLoading(results);
    try {
        const data = await AFP.GET(`/api/doctors?cityId=${cFlt || user?.city_id || ""}&q=${encodeURIComponent(q)}`);
        if (data.length === 0) { renderEmpty(results, "&#x1FA7A;", "No vets found"); return; }
        results.innerHTML = data.map(d => `
            <div class="dir-card" onclick="openDoctorModal(${d.id})">
                <div class="dir-card-avatar" style="background:var(--bl-p)">&#x1F468;&#x200D;&#x2695;&#xFE0F;</div>
                <div style="flex:1">
                    <div style="font-weight:600;font-size:14px;margin-bottom:2px">${escHtml(d.name)}</div>
                    <div style="font-size:12px;color:var(--tx2);margin-bottom:2px">${escHtml(d.specialization || "")}</div>
                    <div style="font-size:11px;color:var(--tx3)">&#x1F4CD; ${escHtml(d.ward_number || "")}, ${escHtml(d.city_name || "")}</div>
                    <div style="margin-top:5px">
                        ${badgeHTML(d.is_24hr ? "24hr Clinic" : "Available", d.is_24hr ? "in" : "ok")}
                    </div>
                </div>
            </div>`).join("");
        results._doctors = data;
    } catch { renderEmpty(results, "&#x1FA7A;", "No vets found"); }
}

function setDoctorFilter(el, city) {
    document.querySelectorAll(".searchdoc-chip").forEach(c => c.classList.remove("active"));
    el.classList.add("active");
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
async function loadSearchShop() {
    await doSearchShop();
}

async function doSearchShop() {
    const q       = document.getElementById("searchshop-q")?.value || "";
    const cFlt    = document.querySelector(".searchshop-chip.active")?.dataset.city || "";
    const user    = AFP.getUser();
    const results = document.getElementById("searchshop-results");
    if (!results) return;
    renderLoading(results);
    try {
        const data = await AFP.GET(`/api/shops?cityId=${cFlt || user?.city_id || ""}&q=${encodeURIComponent(q)}`);
        if (data.length === 0) { renderEmpty(results, "&#x1F6D2;", "No shops found"); return; }
        results.innerHTML = data.map(s => `
            <div class="dir-card" onclick="openShopModal(${s.id})">
                <div class="dir-card-avatar" style="background:#F3E8FF">&#x1F6D2;</div>
                <div style="flex:1">
                    <div style="font-weight:600;font-size:14px;margin-bottom:2px">${escHtml(s.name)}</div>
                    <div style="font-size:12px;color:var(--tx2);margin-bottom:2px">${escHtml(s.speciality || "")}</div>
                    <div style="font-size:11px;color:var(--tx3)">&#x1F4CD; ${escHtml(s.ward_number || "")}, ${escHtml(s.city_name || "")}</div>
                    <div style="margin-top:5px">${badgeHTML("Open", "ok")}</div>
                </div>
            </div>`).join("");
        results._shops = data;
    } catch { renderEmpty(results, "&#x1F6D2;", "No shops found"); }
}

function setShopFilter(el, city) {
    document.querySelectorAll(".searchshop-chip").forEach(c => c.classList.remove("active"));
    el.classList.add("active");
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
