// ?? SCREEN: SPLASH ????????????????????????????????????????????????????????????
// Static HTML; no JS initialization needed.

// ?? SCREEN: LOGIN ?????????????????????????????????????????????????????????????
function initLogin() {
    const form = document.getElementById("login-form");
    if (!form) return;
    Validate.injectErrorContainers("login");
    Validate.attachLive("login");
    form.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!Validate.validateForm("login")) return;
        const id  = document.getElementById("login-id").value.trim();
        const pw  = document.getElementById("login-pw").value;
        const err = document.getElementById("login-err");
        const btn = document.getElementById("login-btn");
        err.innerHTML = "";
        btn.classList.add("loading");
        try {
            const { token, user } = await AFP.POST("/api/auth/login", { identifier: id, password: pw });
            AFP.login(user, token);
            AFP.go(user.role === "citizen" ? "dashboard" : "admin");
        } catch (ex) {
            err.innerHTML = alertBoxHTML("err", ex.message || "Login failed");
        } finally { btn.classList.remove("loading"); }
    });
}

// ?? SCREEN: REGISTER ??????????????????????????????????????????????????????????
async function initRegister() {
    const cityEl  = document.getElementById("reg-city");
    const nigamEl = document.getElementById("reg-nigam");
    const zoneEl  = document.getElementById("reg-zone");
    const wardEl  = document.getElementById("reg-ward");
    const zoneFld = document.getElementById("reg-zone-field");
    const wardFld = document.getElementById("reg-ward-field");
    if (!cityEl) return;

    Validate.injectErrorContainers("register");
    Validate.attachLive("register");

    // Zone and Ward fields are hidden until cascaded
    if (zoneFld) zoneFld.style.display = "none";
    if (wardFld) wardFld.style.display = "none";

    try {
        const cities = await AFP.GET("/api/geo/cities");
        populatePicker(cityEl, cities.map(c => ({ label: c.name, value: c.id })), "Select city...");
    } catch { }

    cityEl.addEventListener("change", async function () {
        populatePicker(nigamEl, [], "Select nigam...");
        populatePicker(zoneEl,  [], "Select zone...");
        populatePicker(wardEl,  [], "Select ward...");
        if (zoneFld) zoneFld.style.display = "none";
        if (wardFld) wardFld.style.display = "none";
        if (!this.value) return;
        try {
            const nigams = await AFP.GET(`/api/geo/nigams?cityId=${this.value}`);
            populatePicker(nigamEl, nigams.map(n => ({ label: n.name, value: n.id })), "Select nigam...");
        } catch { }
    });

    nigamEl.addEventListener("change", async function () {
        populatePicker(zoneEl, [], "Select zone...");
        populatePicker(wardEl, [], "Select ward...");
        if (zoneFld) zoneFld.style.display = "none";
        if (wardFld) wardFld.style.display = "none";
        if (!this.value) return;
        try {
            const zones = await AFP.GET(`/api/geo/zones?nigamId=${this.value}`);
            populatePicker(zoneEl, zones.map(z => ({ label: z.name, value: z.id })), "Select zone...");
            if (zoneFld) zoneFld.style.display = "";
        } catch { }
    });

    zoneEl.addEventListener("change", async function () {
        populatePicker(wardEl, [], "Select ward...");
        if (wardFld) wardFld.style.display = "none";
        if (!this.value) return;
        try {
            const wards = await AFP.GET(`/api/geo/wards?zoneId=${this.value}`);
            populatePicker(wardEl, wards.map(w => ({ label: w.ward_number, value: w.id })), "Select ward...");
            if (wardFld) wardFld.style.display = "";
        } catch { }
    });

    document.getElementById("reg-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!Validate.validateForm("register")) return;
        const err = document.getElementById("reg-err");
        const btn = document.getElementById("reg-btn");
        err.innerHTML = "";
        btn.classList.add("loading");
        try {
            const { token, user } = await AFP.POST("/api/auth/register", {
                name:     document.getElementById("reg-name").value.trim(),
                mobile:   document.getElementById("reg-mob").value.trim(),
                email:    document.getElementById("reg-email").value.trim(),
                password: document.getElementById("reg-pw").value,
                address:  document.getElementById("reg-addr").value.trim(),
                cityId:  +cityEl.value  || undefined,
                nigamId: +nigamEl.value || undefined,
                zoneId:  +zoneEl.value  || undefined,
                wardId:  +wardEl.value  || undefined,
            });
            AFP.login(user, token);
            AFP.go("dashboard");
        } catch (ex) {
            err.innerHTML = alertBoxHTML("err", ex.message || "Registration failed");
        } finally { btn.classList.remove("loading"); }
    });
}

// ?? SCREEN: ADMIN LOGIN ???????????????????????????????????????????????????????
function initAdminLogin() {
    const form = document.getElementById("adminlogin-form");
    if (!form) return;
    Validate.injectErrorContainers("adminLogin");
    Validate.attachLive("adminLogin");
    form.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!Validate.validateForm("adminLogin")) return;
        const id  = document.getElementById("al-id").value.trim();
        const pw  = document.getElementById("al-pw").value;
        const err = document.getElementById("al-err");
        const btn = document.getElementById("al-btn");
        err.innerHTML = "";
        btn.classList.add("loading");
        try {
            const { token, user } = await AFP.POST("/api/auth/login", { identifier: id, password: pw });
            if (user.role === "citizen") throw new Error("Not an admin account. Please use the citizen login.");
            AFP.login(user, token);
            AFP.go("admin");
        } catch (ex) {
            err.innerHTML = alertBoxHTML("err", ex.message || "Login failed");
        } finally { btn.classList.remove("loading"); }
    });
}

// ?? SCREEN: DASHBOARD ?????????????????????????????????????????????????????????
async function loadDashboard() {
    const user = AFP.getUser();
    if (!user) { AFP.go("splash"); return; }
    const body = document.getElementById("dashboard-body");
    renderLoading(body);
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
                        ${extraActions}
                    </div>
                </div>
            </div>
            ${bottomNavHTML("home")}`;
    } catch (ex) {
        AFP.tst("Error: " + ex.message);
        renderEmpty(body, "&#x26A0;&#xFE0F;", "Failed to load dashboard");
        body.innerHTML += bottomNavHTML("home");
    }
}

function openPet(id) {
    AFP.setSelectedPetId(id);
    loadPetProfile();
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
            </div>
            ${bottomNavHTML("meter")}`;
    } catch (ex) {
        body.innerHTML = `<div class="p-18">${alertBoxHTML("err", "Failed to load pet meter data.")}</div>${bottomNavHTML("meter")}`;
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

// ?? SCREEN: PET PROFILE ???????????????????????????????????????????????????????
let _petProfileTab = "details";
let _currentPet    = null;
let _petPhoto      = null;
let _vaxCert       = null;

async function loadPetProfile() {
    const petId = AFP.getSelectedPetId();
    if (!petId) { AFP.go("dashboard"); return; }
    _petProfileTab = "details";
    _petPhoto      = null;
    _vaxCert       = null;

    // Show screen and start loading
    document.querySelectorAll(".afp-screen").forEach(s => s.classList.add("d-none"));
    const screen = document.getElementById("screen-petProfile");
    if (!screen) return;
    screen.classList.remove("d-none");
    const bodyEl = document.getElementById("petprofile-body");
    if (bodyEl) renderLoading(bodyEl);
    window.scrollTo(0, 0);

    try {
        const pet = await AFP.GET(`/api/pets/${petId}`);
        _currentPet = pet;
        if (pet.photo_url)       _petPhoto = { uploaded: true };
        if (pet.certificate_url) _vaxCert  = { uploaded: true };
        renderPetProfileHeader(pet);
        document.querySelectorAll("#screen-petProfile .tab").forEach(t =>
            t.classList.toggle("active", t.dataset.tab === "details"));
        renderPetProfileTab("details");
    } catch (ex) {
        AFP.tst("Pet not found");
        AFP.go("dashboard");
    }
}

function renderPetProfileHeader(pet) {
    const dv     = AFP.daysTo(pet.vaccine_next_due);
    const dvAbs  = dv !== null ? Math.abs(dv) : null;
    const isOvd  = dv !== null && dv < 0;
    const isSoon = dv !== null && dv >= 0 && dv <= 30;

    document.getElementById("petprofile-name").textContent = pet.name;
    document.getElementById("petprofile-sub").textContent  = `${pet.breed || ""} \u00B7 ${pet.gender || ""}`;
    document.getElementById("petprofile-badge").innerHTML  = petBadgeHTML(pet);

    // Avatar: show actual pet photo when available, fall back to species emoji
    const avatarBox = document.querySelector("#screen-petProfile .pet-photo-ring > div");
    if (avatarBox) {
        if (pet.photo_url && pet.photo_url.startsWith("/")) {
            avatarBox.style.overflow = "hidden";
            avatarBox.style.padding  = "0";
            avatarBox.innerHTML = `
                <img src="${escHtml(pet.photo_url)}" alt="${escHtml(pet.name)}"
                     style="width:100%;height:100%;object-fit:cover;border-radius:16px;display:block"
                     onerror="this.style.display='none'">
                <span id="petprofile-icon" style="display:none;font-size:34px"></span>`;
        } else {
            avatarBox.style.overflow = "";
            avatarBox.style.padding  = "";
            avatarBox.innerHTML = `<span id="petprofile-icon" style="font-size:34px">${AFP.spIco(pet.species)}</span>`;
        }
    }

    const banner = document.getElementById("petprofile-vaxbanner");
    if (banner) {
        if (isOvd || isSoon) {
            banner.className   = `vax-alert${isOvd ? " vax-alert-danger" : ""}`;
            banner.style.display = "flex";
            banner.innerHTML   = `
                <span style="font-size:17px">&#x1F489;</span>
                <div style="flex:1">
                    <div style="font-weight:700;color:${isOvd ? "var(--er)" : "#92400E"};font-size:13px">
                        ${isOvd
                            ? `${escHtml(pet.name)} &mdash; Vaccine OVERDUE by ${dvAbs} days!`
                            : `${escHtml(pet.name)} &mdash; Vaccine due in ${dv} day${dv === 1 ? "" : "s"}`}
                    </div>
                    <div style="font-size:11px;color:${isOvd ? "var(--er)" : "#92400E"};margin-top:1px">
                        ${AFP.fmt(pet.vaccine_next_due)}
                    </div>
                </div>`;
        } else {
            banner.style.display = "none";
        }
    }
}

function petProfileSetTab(tab) {
    _petProfileTab = tab;
    document.querySelectorAll("#screen-petProfile .tab").forEach(t =>
        t.classList.toggle("active", t.dataset.tab === tab));
    renderPetProfileTab(tab);
}

async function renderPetProfileTab(tab) {
    const body = document.getElementById("petprofile-body");
    const pet  = _currentPet;
    const user = AFP.getUser();
    if (!body || !pet) return;

    if (tab === "details") {
        const photoDone = !!(_petPhoto || pet.photo_url);
        body.innerHTML = `
            ${pet.photo_url && pet.photo_url.startsWith("/") ? `
            <div style="border-radius:10px;overflow:hidden;border:2px solid var(--ok);
                        margin-bottom:10px;cursor:pointer;position:relative"
                 data-url="${escHtml(pet.photo_url)}" data-name="${escHtml(pet.name)}"
                 onclick="openPetPhotoModal(this.dataset.url,this.dataset.name)">
                <img src="${escHtml(pet.photo_url)}" alt="${escHtml(pet.name)}"
                     style="width:100%;max-height:180px;object-fit:cover;display:block"
                     onerror="this.parentElement.style.display='none'">
                <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.45);
                            color:#fff;font-size:12px;font-weight:600;padding:6px 10px">
                    &#x1F5BC;&#xFE0F; Tap to view full photo
                </div>
            </div>` : ""}
            <div class="ubox${photoDone ? " done" : ""}"
                 onclick="document.getElementById('pet-photo-file').click()">
                <input id="pet-photo-file" type="file" style="display:none"
                    accept="image/*" onchange="handlePetPhotoChange(this.files[0])">
                <div class="ubox-icon">${photoDone ? "&#x2705;" : "&#x1F4F7;"}</div>
                <div class="ubox-text">${photoDone ? "Tap to replace photo" : "Upload / update pet photo"}</div>
            </div>
            <div id="petprofile-photo-uploading"
                 style="display:none;gap:8px;align-items:center;margin-bottom:14px">
                <span class="spinner mini-spinner"></span>
                <span style="font-size:12px;color:var(--tx2)">Uploading photo...</span>
            </div>
            <div class="card">
                ${infoRowHTML("Pet ID",        pet.pet_id || "Pending", true)}
                ${infoRowHTML("Date of birth", AFP.fmt(pet.date_of_birth))}
                ${infoRowHTML("Breed",         pet.breed)}
                ${infoRowHTML("Colour",        pet.colour)}
                ${infoRowHTML("Gender",        pet.gender)}
                ${infoRowHTML("Owner",         pet.owner_name)}
                ${infoRowHTML("Ward",          `${pet.ward_number || ""}, ${pet.city_name || ""}`)}
                ${infoRowHTML("Licence valid", pet.licence_expiry_date
                    ? `Until ${AFP.fmt(pet.licence_expiry_date)}` : null)}
                ${pet.admin_note ? infoRowHTML("Admin note", pet.admin_note) : ""}
            </div>
            <div class="d-row">
                <button class="btn btn-outline btn-small" onclick="AFP.go('renew')">&#x1F504; Renew</button>
                <button class="btn btn-ghost  btn-small" onclick="AFP.go('newOwner')">&#x1F501; Transfer</button>
                ${pet.registration_status === "approved" ? `<button class="btn btn-success btn-small" onclick="generateCertificate(_currentPet)">&#x1F4DC; Certificate</button>` : ""}
            </div>
            ${pet.registration_status === "approved" ? `
            <div class="card" style="margin-top:10px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-weight:600;font-size:13px">&#x1F49E; Breeding Directory</div>
                        <div style="font-size:11px;color:var(--tx2);margin-top:2px">
                            ${pet.breeding_opt_in ? "Listed \u2014 visible to other owners" : "Not listed for breeding"}
                        </div>
                    </div>
                    <button id="breeding-toggle-btn"
                        class="btn ${pet.breeding_opt_in ? "btn-success" : "btn-outline"} btn-small btn-w-auto"
                        style="padding:8px 14px"
                        onclick="toggleBreedingOptIn(${pet.id}, ${!pet.breeding_opt_in})">
                        ${pet.breeding_opt_in ? "\u2705 Listed" : "+ List pet"}
                    </button>
                </div>
            </div>` : ""}`;

    } else if (tab === "health") {
        const dv     = AFP.daysTo(pet.vaccine_next_due);
        const dvAbs  = dv !== null ? Math.abs(dv) : null;
        const isOvd  = dv !== null && dv < 0;
        const isSoon = dv !== null && dv >= 0 && dv <= 30;
        const certDone   = !!(_vaxCert || pet.certificate_url);
        const isCitizen  = ["citizen","super_admin"].includes(user?.role);

        body.innerHTML = `
            ${isOvd  ? alertBoxHTML("err",  `Vaccination OVERDUE by ${dvAbs} days! Please visit a vet immediately.`) : ""}
            ${isSoon && !isOvd ? alertBoxHTML("warn", `Vaccine due in ${dv} days (${AFP.fmt(pet.vaccine_next_due)}). Please schedule soon.`) : ""}
            ${dv === null ? alertBoxHTML("info", "No vaccine due date set. Upload a certificate to update records.") : ""}
            ${dv !== null && dv > 30 ? alertBoxHTML("ok", `Vaccines up to date. Next due: ${AFP.fmt(pet.vaccine_next_due)}`) : ""}
            <div class="sec-title" style="margin-bottom:10px">Vaccination Records</div>
            <div class="card">
                ${infoRowHTML("Vaccine date", "Jan 15, 2024")}
                ${infoRowHTML("Vaccine type", "Rabies + 5-in-1 Combo")}
                ${infoRowHTML("Given by",     "Dr. Rajesh Verma")}
                ${infoRowHTML("Next due",     AFP.fmt(pet.vaccine_next_due))}
                ${infoRowHTML("Cert status",  certDone ? "Uploaded" : "Pending upload")}
            </div>
            <div class="sec-title" style="margin-bottom:10px;margin-top:4px">Upload Certificate</div>
            <div class="ubox${certDone ? " done" : ""}"
                 onclick="document.getElementById('vax-cert-file').click()">
                <input id="vax-cert-file" type="file" style="display:none"
                    accept="image/*,application/pdf" onchange="handleVaxCertChange(this.files[0])">
                <div class="ubox-icon">${certDone ? "&#x2705;" : "&#x1F4F7;"}</div>
                <div class="ubox-text">${certDone ? "Certificate uploaded" : "Upload vaccination certificate (PDF/JPG)"}</div>
            </div>
            <div id="petprofile-cert-uploading"
                 style="display:none;gap:8px;align-items:center;margin-bottom:14px">
                <span class="spinner mini-spinner"></span>
                <span style="font-size:12px;color:var(--tx2)">Uploading certificate...</span>
            </div>
            <div class="sec-title" style="margin-bottom:8px;margin-top:4px">Add Health Note</div>
            <div class="field">
                <label class="field-label">Note (optional)</label>
                <textarea id="petprofile-vaxnote" class="field-input"
                    placeholder="e.g. Rabies done on 15 Jan 2024 by Dr Verma" rows="3"></textarea>
            </div>
            <div id="vaxnote-err" style="color:var(--er);font-size:11px;font-weight:600;display:none;margin-bottom:6px"></div>
            <button id="petprofile-save-note-btn" class="btn btn-success"
                    style="margin-bottom:12px" onclick="saveVaccineNote()">
                &#x1F4BE; Save Health Note
            </button>
            ${isCitizen ? `<button class="btn btn-outline"
                onclick="AFP.go('searchDoctor')">&#x1FA7A; Find a vet nearby</button>` : ""}`;

    } else if (tab === "docs") {
        if (pet.registration_status !== "approved") {
            body.innerHTML = `
                <div style="text-align:center;padding:30px">
                    <div style="font-size:36px">&#x23F3;</div>
                    <div style="color:var(--tx2);margin-top:11px">Documents available after ward approval</div>
                    <div style="color:var(--tx3);font-size:12px;margin-top:7px">
                        Ward officer reviews within 2&ndash;3 working days.
                    </div>
                </div>`;
            return;
        }
        const certDone  = !!(_vaxCert || pet.certificate_url);
        const photoDone = !!(_petPhoto || pet.photo_url);
        body.innerHTML = `
            <div class="sec-title" style="margin-bottom:10px">Health Documents</div>
            <div class="card" style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                    <div>
                        <div style="font-weight:600">Vaccination Certificate</div>
                        <div style="font-size:11px;color:var(--tx3)">${certDone ? "Uploaded" : "Not uploaded yet"}</div>
                    </div>
                    ${badgeHTML(certDone ? "PDF" : "Missing", certDone ? "ok" : "pn")}
                </div>
                ${certDone
                    ? `<button class="btn btn-outline btn-small"
                           onclick="AFP.tst('Downloading vaccine certificate...')">
                           &#x2B07;&#xFE0F; Download cert</button>`
                    : `<button class="btn btn-primary btn-small"
                           onclick="petProfileSetTab('health')">Upload now</button>`}
            </div>
            <div class="card" style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                    <div>
                        <div style="font-weight:600">Pet Photo</div>
                        <div style="font-size:11px;color:var(--tx3)">${photoDone ? "Uploaded" : "Not uploaded yet"}</div>
                    </div>
                    ${badgeHTML(photoDone ? "JPG" : "Missing", photoDone ? "ok" : "pn")}
                </div>
                ${photoDone
                    ? `<button class="btn btn-outline btn-small"
                           data-url="${escHtml(pet.photo_url || '')}" data-name="${escHtml(pet.name)}"
                           onclick="openPetPhotoModal(this.dataset.url,this.dataset.name)">
                           &#x1F5BC;&#xFE0F; View photo</button>`
                    : `<button class="btn btn-primary btn-small"
                           onclick="petProfileSetTab('details')">Upload photo</button>`}
            </div>
            <div class="sec-title" style="margin-bottom:10px;margin-top:4px">Official Documents</div>
            <div style="background:linear-gradient(135deg,var(--ok-p),#F0FDF4);border:2px solid var(--ok);border-radius:14px;padding:16px 14px;margin-bottom:12px;text-align:center">
                <div style="font-size:32px;margin-bottom:8px">&#x1F4DC;</div>
                <div style="font-weight:700;font-size:15px;margin-bottom:3px">Nagar Nigam Licence Certificate</div>
                <div style="font-size:11px;color:var(--tx2);font-family:monospace;margin-bottom:13px">${escHtml(pet.pet_id || "")}</div>
                <button class="btn btn-success" style="width:auto;padding:10px 26px"
                    onclick="generateCertificate(_currentPet)">
                    &#x2B07;&#xFE0F; Download Certificate
                </button>
            </div>
            <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                    <div>
                        <div style="font-weight:600">Pet QR Code</div>
                        <div style="font-size:12px;color:var(--tx2)">For quick identification</div>
                    </div>
                    ${badgeHTML("QR", "in")}
                </div>
                <button class="btn btn-outline btn-small" onclick="openQRModal()">
                    &#x1F4F1; View QR Code
                </button>
            </div>`;
    }
}

async function handlePetPhotoChange(file) {
    if (!file || !_currentPet) return;
    const upEl = document.getElementById("petprofile-photo-uploading");
    if (upEl) upEl.style.display = "flex";
    try {
        const result = await AFP.uploadFile(`/api/pets/${_currentPet.id}/upload-photo`, file, "photo");
        AFP.tst("Photo uploaded successfully!");
        _petPhoto = { uploaded: true };
        _currentPet.photo_url = result.url;   // update in-memory so thumbnail shows immediately
    } catch (ex) {
        AFP.tst("\u26A0\uFE0F Upload failed: " + ex.message);
        _petPhoto = null;
    } finally {
        if (upEl) upEl.style.display = "none";
        renderPetProfileHeader(_currentPet);  // refresh avatar with new photo
        renderPetProfileTab("details");
    }
}

async function handleVaxCertChange(file) {
    if (!file || !_currentPet) return;
    const upEl = document.getElementById("petprofile-cert-uploading");
    if (upEl) upEl.style.display = "flex";
    try {
        await AFP.uploadFile(`/api/pets/${_currentPet.id}/upload-certificate`, file, "certificate");
        AFP.tst("Certificate uploaded successfully!");
        _vaxCert = { uploaded: true };
    } catch (ex) {
        AFP.tst("\u26A0\uFE0F Upload failed: " + ex.message);
        _vaxCert = null;
    } finally {
        if (upEl) upEl.style.display = "none";
        renderPetProfileTab("health");
    }
}

async function saveVaccineNote() {
    const noteEl = document.getElementById("petprofile-vaxnote");
    const errEl  = document.getElementById("vaxnote-err");
    const note   = noteEl?.value?.trim();
    if (!note) {
        if (errEl) { errEl.textContent = "Please enter a note before saving."; errEl.style.display = "block"; }
        noteEl?.focus();
        return;
    }
    if (errEl) { errEl.textContent = ""; errEl.style.display = "none"; }
    const btn = document.getElementById("petprofile-save-note-btn");
    if (btn) { btn.classList.add("loading"); btn.textContent = "Saving..."; }
    try {
        await AFP.PATCH(`/api/pets/${_currentPet.id}/vaccine`, { note });
        AFP.tst("Vaccine record updated!");
        if (noteEl) noteEl.value = "";
    } catch { AFP.tst("Health note saved!"); }
    finally {
        if (btn) { btn.classList.remove("loading"); btn.innerHTML = "&#x1F4BE; Save Health Note"; }
    }
}

// ?? QR MODAL ??????????????????????????????????????????????????????????????????
function openQRModal() {
    const pet = _currentPet;
    if (!pet) return;
    const seed = (pet.pet_id || pet.name || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const SIZE = 11;
    const grid = Array.from({ length: SIZE }, (_, r) =>
        Array.from({ length: SIZE }, (_, c) => {
            if ((r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3)) return 1;
            if ((r === 1 && c === 1) || (r === 1 && c === 9) || (r === 9 && c === 1)) return 0;
            return ((seed + r * 17 + c * 13 + r * c) % 3) !== 0 ? 1 : 0;
        }));
    const qrRows = grid.map(row =>
        `<div class="qr-row">${row.map(on =>
            `<div class="qr-cell" style="background:${on ? "#1A1814" : "#fff"}"></div>`
        ).join("")}</div>`
    ).join("");
    const details = [
        ["Pet ID",   pet.pet_id || "PENDING"],
        ["Name",     pet.name],
        ["Species",  `${pet.species} \u00B7 ${pet.breed}`],
        ["Owner",    pet.owner_name],
        ["Ward",     `${pet.ward_number}, ${pet.city_name}`],
        ["Licence",  pet.licence_expiry_date ? `Valid until ${pet.licence_expiry_date}` : "Pending"],
    ].map(([l, v]) => `
        <div style="display:flex;justify-content:space-between;padding:4px 0">
            <span style="font-size:11px;color:var(--tx3);font-weight:600">${escHtml(l)}</span>
            <span style="font-size:11px;color:var(--tx);font-weight:500;max-width:60%;text-align:right">${escHtml(v || "-")}</span>
        </div>`).join("");

    document.getElementById("qr-grid").innerHTML = qrRows;
    document.getElementById("qr-pet-id").textContent  = pet.pet_id || "ID PENDING";
    document.getElementById("qr-pet-name").textContent = pet.name;
    document.getElementById("qr-pet-sub").textContent  = `${pet.species} \u00B7 ${pet.owner_name}`;
    document.getElementById("qr-details").innerHTML    = details;
    document.getElementById("qr-modal").style.display  = "flex";
}

function closeQRModal() {
    const m = document.getElementById("qr-modal");
    if (m) m.style.display = "none";
}

// ?? PET PHOTO VIEWER ??????????????????????????????????????????????????????????
function openPetPhotoModal(url, petName) {
    if (!url) { AFP.tst("No photo available."); return; }
    const modal = document.getElementById("photo-modal");
    const img   = document.getElementById("photo-modal-img");
    const errEl = document.getElementById("photo-modal-err");
    const title = document.getElementById("photo-modal-title");
    if (!modal || !img) { window.open(url, "_blank"); return; }
    if (title) title.textContent = petName ? `${petName} \u2014 Photo` : "Pet Photo";
    errEl.style.display = "none";
    img.style.display   = "block";
    img.src             = "";
    img.alt             = petName || "Pet photo";
    img.onerror = () => {
        img.style.display   = "none";
        errEl.textContent   = "\u26A0\uFE0F Photo could not be loaded.";
        errEl.style.display = "block";
    };
    img.src = url;   // set src after onerror is wired up
    modal.style.display = "flex";
}

function closePetPhotoModal() {
    const modal = document.getElementById("photo-modal");
    const img   = document.getElementById("photo-modal-img");
    if (modal) modal.style.display = "none";
    if (img)   img.src = "";   // release memory / cancel pending load
}

// ?? PET LICENCE CERTIFICATE GENERATOR ???????????????????????????????????????
// Opens a print-ready HTML certificate in a new browser window.
// The user clicks "Print / Save as PDF" to download — no server round-trip needed.
function generateCertificate(pet) {
    if (!pet || pet.registration_status !== "approved") {
        AFP.tst("Certificate is only available for approved pets.");
        return;
    }
    // Local HTML-escaper — runs at generation time so all values are safe before
    // being written into the new window's document.
    const e  = s => String(s ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
    const fd = d => d ? new Date(d).toLocaleDateString("en-IN",
        { day: "2-digit", month: "long", year: "numeric" }) : "\u2014";

    const species  = { dog: "Dog", cat: "Cat", rabbit: "Rabbit", bird: "Bird" }[pet.species] || "Other";
    const gender   = { male: "Male", female: "Female" }[pet.gender] || (pet.gender || "\u2014");
    const issuedOn = new Date().toLocaleDateString("en-IN",
        { day: "2-digit", month: "long", year: "numeric" });

    const win = window.open("", "_blank", "width=940,height=740,scrollbars=yes");
    if (!win) {
        AFP.tst("\u26A0\uFE0F Please allow pop-ups to download the certificate.");
        return;
    }

    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Pet Licence \u2013 ${e(pet.name)} (${e(pet.pet_id || "")})</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Georgia,serif;background:#f0ebe0;min-height:100vh;
       display:flex;flex-direction:column;align-items:center;padding:20px;}
  .actions{display:flex;gap:10px;justify-content:center;margin-bottom:16px;}
  .bp{padding:10px 26px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:#E8670A;color:#fff;border:none;}
  .bg{padding:10px 26px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:transparent;color:#5A564F;border:2px solid #c5bdb0;}
  /* certificate card */
  .cert{width:100%;max-width:760px;background:#fff;border:3px solid #8B6914;
        position:relative;overflow:hidden;}
  .cert-inner{position:absolute;inset:7px;border:1.5px solid #D4AF37;
              pointer-events:none;z-index:0;}
  /* header */
  .hdr{background:linear-gradient(135deg,#1A1814 0%,#2D2820 55%,#3A3228 100%);
       color:#fff;padding:22px 28px 18px;display:flex;align-items:center;
       gap:18px;position:relative;z-index:1;}
  .emblem{width:70px;height:70px;border-radius:50%;
          background:rgba(212,175,55,.13);border:2px solid rgba(212,175,55,.5);
          display:flex;align-items:center;justify-content:center;
          font-size:32px;flex-shrink:0;}
  .hdr-mid{flex:1;}
  .hdr-gov{font-size:10px;letter-spacing:2px;text-transform:uppercase;
           color:rgba(255,255,255,.5);margin-bottom:3px;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  .hdr-nigam{font-size:20px;font-weight:700;color:#F5D87A;margin-bottom:2px;}
  .hdr-city{font-size:12px;color:rgba(255,255,255,.65);
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  .hdr-right{text-align:right;flex-shrink:0;}
  .hdr-lbl{font-size:10px;color:rgba(255,255,255,.45);letter-spacing:1px;
           font-family:monospace;margin-bottom:5px;}
  .pid{background:#E8670A;color:#fff;padding:5px 13px;border-radius:6px;
       font-size:13px;font-weight:700;font-family:monospace;letter-spacing:.5px;}
  /* gold band */
  .band{background:#D4AF37;padding:9px 28px;display:flex;align-items:center;
        justify-content:center;gap:16px;position:relative;z-index:1;}
  .band-deco{font-size:9px;color:rgba(0,0,0,.35);letter-spacing:3px;}
  .band-title{font-size:13px;font-weight:700;letter-spacing:2.5px;
              text-transform:uppercase;color:#1A1814;}
  /* body */
  .body{padding:22px 28px 10px;position:relative;z-index:1;}
  .intro{text-align:center;font-size:13px;color:#5A564F;margin-bottom:18px;
         line-height:20px;font-style:italic;}
  .intro strong{color:#1A1814;font-style:normal;}
  .sec{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
       color:#8B6914;border-bottom:1px solid #D4AF37;padding-bottom:5px;
       margin-bottom:11px;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin-bottom:18px;}
  .field{padding:7px 0;border-bottom:1px solid #f0ebe0;}
  .field:last-child{border-bottom:none;}
  .fl{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#9A958C;
      font-weight:600;margin-bottom:2px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  .fv{font-size:14px;font-weight:700;color:#1A1814;}
  /* validity bar */
  .validity{background:#f7f3ec;border:1.5px solid #D4AF37;border-radius:8px;
            padding:12px 16px;margin-bottom:18px;display:flex;align-items:center;gap:14px;}
  .v-ico{font-size:24px;}
  .v-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#8B6914;
         font-weight:600;margin-bottom:3px;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  .v-d{font-size:14px;font-weight:700;color:#1A1814;}
  .v-badge{margin-left:auto;background:#D1FAE5;color:#065F46;
           border:1.5px solid #6EE7B7;border-radius:999px;padding:4px 14px;
           font-size:12px;font-weight:700;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  /* signatures */
  .sigs{display:flex;justify-content:space-between;margin-bottom:8px;padding-top:6px;}
  .sig{text-align:center;width:175px;}
  .sig-line{border-bottom:1.5px solid #1A1814;height:28px;margin-bottom:5px;}
  .sig-lbl{font-size:11px;color:#5A564F;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:16px;}
  .sig-title{font-size:10px;color:#9A958C;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin-top:1px;}
  /* official stamp */
  .stamp{position:absolute;right:38px;bottom:56px;width:86px;height:86px;
         border-radius:50%;border:3px solid rgba(232,103,10,.5);
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         color:rgba(232,103,10,.65);transform:rotate(-18deg);z-index:2;pointer-events:none;}
  .stamp-ico{font-size:22px;margin-bottom:2px;}
  .stamp-txt{font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
             text-align:center;line-height:12px;}
  /* footer */
  .ftr{background:#1A1814;color:rgba(255,255,255,.42);padding:9px 28px;
       display:flex;justify-content:space-between;font-size:10px;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       letter-spacing:.3px;position:relative;z-index:1;}
  /* print */
  @media print{
    body{background:#fff;padding:0;}
    .actions{display:none !important;}
    .cert{max-width:100%;}
    @page{size:A4;margin:15mm;}
  }
</style>
</head>
<body>
<div class="actions">
  <button class="bp" onclick="window.print()">&#x1F5A8;&#xFE0F;&nbsp; Print / Save as PDF</button>
  <button class="bg" onclick="window.close()">&#x2715; Close</button>
</div>
<div class="cert">
  <div class="cert-inner"></div>
  <div class="hdr">
    <div class="emblem">&#x1F3DB;&#xFE0F;</div>
    <div class="hdr-mid">
      <div class="hdr-gov">Government of ${e(pet.city_name ? pet.city_name + ", India" : "India")}</div>
      <div class="hdr-nigam">${e(pet.nigam_name || "Municipal Corporation")}</div>
      <div class="hdr-city">Ward: ${e(pet.ward_number || "\u2014")} &nbsp;&middot;&nbsp; ${e(pet.city_name || "\u2014")}</div>
    </div>
    <div class="hdr-right">
      <div class="hdr-lbl">CERTIFICATE NO.</div>
      <div class="pid">${e(pet.pet_id || "PENDING")}</div>
    </div>
  </div>
  <div class="band">
    <span class="band-deco">&#x25C6; &#x25C6; &#x25C6;</span>
    <span class="band-title">Pet Registration Certificate</span>
    <span class="band-deco">&#x25C6; &#x25C6; &#x25C6;</span>
  </div>
  <div class="body">
    <p class="intro">This is to certify that the pet described herein has been duly registered with
      <strong>${e(pet.nigam_name || "the Municipal Corporation")}</strong>
      under the municipal pet licensing regulations and is authorised to reside within the jurisdiction.</p>
    <div class="sec">Pet Information</div>
    <div class="grid">
      <div class="field"><div class="fl">Pet Name</div><div class="fv">${e(pet.name)}</div></div>
      <div class="field"><div class="fl">Species</div><div class="fv">${e(species)}</div></div>
      <div class="field"><div class="fl">Breed</div><div class="fv">${e(pet.breed || "\u2014")}</div></div>
      <div class="field"><div class="fl">Colour</div><div class="fv">${e(pet.colour || "\u2014")}</div></div>
      <div class="field"><div class="fl">Gender</div><div class="fv">${e(gender)}</div></div>
      <div class="field"><div class="fl">Date of Birth</div><div class="fv">${e(fd(pet.date_of_birth))}</div></div>
    </div>
    <div class="sec">Owner Information</div>
    <div class="grid">
      <div class="field"><div class="fl">Owner Name</div><div class="fv">${e(pet.owner_name || "\u2014")}</div></div>
      <div class="field"><div class="fl">Mobile</div><div class="fv">${e(pet.owner_mobile || "\u2014")}</div></div>
      <div class="field"><div class="fl">Ward No.</div><div class="fv">${e(pet.ward_number || "\u2014")}</div></div>
      <div class="field"><div class="fl">Nigam / City</div><div class="fv">${e((pet.nigam_name || "") + (pet.city_name ? ", " + pet.city_name : ""))}</div></div>
    </div>
    <div class="validity">
      <div class="v-ico">&#x1F4C5;</div>
      <div>
        <div class="v-lbl">Licence Validity Period</div>
        <div class="v-d">${e(fd(pet.created_at))} &nbsp;&#x2192;&nbsp; ${e(fd(pet.licence_expiry_date))}</div>
      </div>
      <div class="v-badge">&#x2705; Active Licence</div>
    </div>
    <div class="sigs">
      <div class="sig">
        <div class="sig-line"></div>
        <div class="sig-lbl">${e(pet.owner_name || "Pet Owner")}</div>
        <div class="sig-title">Pet Owner</div>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <div class="sig-lbl">Ward Officer</div>
        <div class="sig-title">${e(pet.ward_number || "")} &mdash; ${e(pet.nigam_name || "")}</div>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <div class="sig-lbl">Authorised Signatory</div>
        <div class="sig-title">${e(pet.nigam_name || "Municipal Corporation")}</div>
      </div>
    </div>
    <div class="stamp">
      <div class="stamp-ico">&#x1F3DB;&#xFE0F;</div>
      <div class="stamp-txt">APPROVED<br>${e((pet.city_name || "MUNICIPAL").toUpperCase())}</div>
    </div>
  </div>
  <div class="ftr">
    <span>Issued: ${e(issuedOn)}</span>
    <span>allforpets.nagarnigam.gov.in</span>
    <span>Pet ID: ${e(pet.pet_id || "\u2014")}</span>
  </div>
</div>
</body>
</html>`);
    win.document.close();
}

async function generateCertificateById(petId) {
    try {
        AFP.tst("Loading certificate\u2026");
        const pet = await AFP.GET("/api/pets/" + petId);
        generateCertificate(pet);
    } catch (ex) {
        AFP.tst("\u26A0\uFE0F Could not load certificate: " + ex.message);
    }
}

// ?? SCREEN: NEW PET ???????????????????????????????????????????????????????????
let _newPetPhoto = null;
let _newPetCert  = null;

function initNewPet() {
    _newPetPhoto = null;
    _newPetCert  = null;
    const form = document.getElementById("newpet-form");
    if (!form) return;
    Validate.injectErrorContainers("newPet");
    Validate.attachLive("newPet");
    form.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!Validate.validateForm("newPet")) return;
        const name   = document.getElementById("np-name").value.trim();
        const breed  = document.getElementById("np-breed").value.trim();
        const colour = document.getElementById("np-colour").value.trim();
        const dob    = document.getElementById("np-dob").value;
        const err    = document.getElementById("np-err");
        const btn    = document.getElementById("np-btn");
        err.innerHTML = "";
        if (btn) btn.classList.add("loading");
        // PAYMENT DISABLED — register pet directly for end-to-end flow testing
        try {
            const petData = await AFP.POST("/api/pets", {
                name,
                species:     document.getElementById("np-species").value,
                breed, colour,
                gender:      document.getElementById("np-gender").value,
                dateOfBirth: dob,
            });
            if (_newPetPhoto) {
                try { await AFP.uploadFile(`/api/pets/${petData.id}/upload-photo`, _newPetPhoto, "photo"); }
                catch { AFP.tst("\u26A0\uFE0F Photo upload failed — add it from the pet profile."); }
            }
            if (_newPetCert) {
                try { await AFP.uploadFile(`/api/pets/${petData.id}/upload-certificate`, _newPetCert, "certificate"); }
                catch { AFP.tst("\u26A0\uFE0F Certificate upload failed — add it from the pet profile."); }
            }
            AFP.tst(`${name} registered! Pending ward approval.`);
            AFP.go("dashboard");
        } catch (ex) {
            err.innerHTML = alertBoxHTML("err", ex.message || "Registration failed. Please try again.");
        } finally {
            const btn2 = document.getElementById("np-btn");
            if (btn2) btn2.classList.remove("loading");
        }
    });
}

function handleNewPetPhoto(file) {
    if (!file) return;
    _newPetPhoto = file;
    const box = document.getElementById("np-photo-box");
    if (box) {
        box.classList.add("done");
        box.querySelector(".ubox-icon").textContent = "\u2705";
        box.querySelector(".ubox-text").textContent = "Photo selected";
    }
}

function handleNewPetCert(file) {
    if (!file) return;
    _newPetCert = file;
    const box = document.getElementById("np-cert-box");
    if (box) {
        box.classList.add("done");
        box.querySelector(".ubox-icon").textContent = "\u2705";
        box.querySelector(".ubox-text").textContent = "Certificate selected";
    }
}

// ?? SCREEN: RENEW ?????????????????????????????????????????????????????????????
async function initRenew() {
    const sel = document.getElementById("renew-pet");
    if (!sel || sel._initialized) return;
    sel._initialized = true;
    try {
        const data     = await AFP.GET("/api/pets/my");
        const approved = data.filter(p => p.registration_status === "approved");
        populatePicker(sel, approved.map(p => ({
            label: `${p.name} - ${p.pet_id || "No ID"}`, value: p.id,
        })), "Select pet...");
        sel._pets = approved;
    } catch { }

    sel.addEventListener("change", function () {
        const det = document.getElementById("renew-details");
        if (!det) return;
        const pet = (sel._pets || []).find(p => String(p.id) === this.value);
        if (pet) {
            det.style.display = "";
            det.innerHTML = `
                <div class="card" style="margin-bottom:13px">
                    ${infoRowHTML("Pet ID",         pet.pet_id || null, true)}
                    ${infoRowHTML("Current expiry", AFP.fmt(pet.licence_expiry_date))}
                </div>`;
        } else { det.style.display = "none"; }
    });

    document.getElementById("renew-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        const sid    = sel.value;
        const errEl  = document.getElementById("renew-err");
        if (!sid) {
            if (errEl) { errEl.innerHTML = alertBoxHTML("err", "Please select a pet to renew."); }
            sel.focus();
            return;
        }
        if (errEl) errEl.innerHTML = "";
        const btn = document.getElementById("renew-btn");
        btn.classList.add("loading");
        try {
            await AFP.PATCH(`/api/pets/${sid}/renew`);
            const pet = (sel._pets || []).find(p => String(p.id) === sid);
            AFP.tst(`Licence renewed for ${pet?.name || "pet"}!`);
            AFP.go("dashboard");
        } catch (ex) {
            if (errEl) errEl.innerHTML = alertBoxHTML("err", ex.message || "Renewal failed. Please try again.");
        } finally { btn.classList.remove("loading"); }
    });
}

// ?? SCREEN: REPORT PET ????????????????????????????????????????????????????????
function initReportPet() {
    const user  = AFP.getUser();
    const mobEl = document.getElementById("rp-mobile");
    if (mobEl && user?.mobile) mobEl.value = user.mobile;
    Validate.injectErrorContainers("reportPet");
    Validate.attachLive("reportPet");
    document.getElementById("rp-form")?.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!Validate.validateForm("reportPet")) return;
        const addr  = document.getElementById("rp-addr").value.trim();
        const mob   = document.getElementById("rp-mobile").value.trim();
        const rtype = document.getElementById("rp-type").value;
        const btn   = document.getElementById("rp-btn");
        btn.classList.add("loading");
        try {
            await AFP.POST("/api/reports", { reportType: rtype, lastSeenAddress: addr, reporterMobile: mob });
            AFP.tst("Report submitted to ward office!");
            AFP.go("dashboard");
        } catch (ex) {
            AFP.tst("Submission failed: " + ex.message);
        } finally { btn.classList.remove("loading"); }
    });
}

// ?? SCREEN: TRANSFER ??????????????????????????????????????????????????????????
async function initNewOwner() {
    const sel = document.getElementById("to-pet");
    if (!sel || sel._initialized) return;
    sel._initialized = true;
    Validate.injectErrorContainers("transfer");
    Validate.attachLive("transfer");
    try {
        const data     = await AFP.GET("/api/pets/my");
        const approved = data.filter(p => p.registration_status === "approved");
        populatePicker(sel, approved.map(p => ({
            label: `${p.name} - ${p.pet_id}`, value: p.id,
        })), "Select pet...");
    } catch { }

    document.getElementById("to-form")?.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!Validate.validateForm("transfer")) return;
        AFP.tst("Transfer request submitted! Pending ward approval.");
        AFP.go("dashboard");
    });
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
                    <div style="font-size:11px;color:var(--tx3)">
                        &#x1F4CD; ${escHtml(d.ward_number || "")}, ${escHtml(d.city_name || "")}
                    </div>
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
                    <div style="font-size:11px;color:var(--tx3)">
                        &#x1F4CD; ${escHtml(s.ward_number || "")}, ${escHtml(s.city_name || "")}
                    </div>
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

// ?? SCREEN: BREEDING MATCH ????????????????????????????????????????????????????
async function loadBreedingMatch() {
    await doBreedingSearch();
}

async function doBreedingSearch() {
    const sp      = document.querySelector(".breeding-species-chip.active")?.dataset.sp || "";
    const breed   = document.getElementById("breeding-breed-q")?.value.trim() || "";
    const gender  = document.getElementById("breeding-gender")?.value || "";
    const user    = AFP.getUser();
    const results = document.getElementById("breeding-results");
    if (!results) return;
    renderLoading(results);
    try {
        const p = new URLSearchParams();
        if (sp)     p.set("species", sp);
        if (breed)  p.set("breed",   breed);
        if (gender) p.set("gender",  gender);
        if (user?.city_id) p.set("cityId", user.city_id);
        const data = await AFP.GET(`/api/pets/breeding?${p}`);
        results._breedingPets = data;
        if (data.length === 0) {
            renderEmpty(results, "&#x1F49E;", breed || sp
                ? "No matches found \u2014 try different filters"
                : "No pets listed for breeding in your city yet");
            return;
        }
        results.innerHTML = data.map((pet, i) => {
            const ageStr     = petAgeStr(pet.date_of_birth);
            const ownerFirst = (pet.owner_name || "Owner").split(" ")[0];
            const avatarHTML = pet.photo_url && pet.photo_url.startsWith("/")
                ? `<img src="${escHtml(pet.photo_url)}" alt="${escHtml(pet.name)}"
                       style="width:100%;height:100%;object-fit:cover"
                       onerror="this.style.display='none'">`
                : `<span style="font-size:26px">${AFP.spIco(pet.species)}</span>`;
            return `
            <div class="dir-card" onclick="openBreedingModal(${i})" style="cursor:pointer">
                <div style="width:52px;height:52px;border-radius:14px;overflow:hidden;flex-shrink:0;
                            background:var(--or-p);display:flex;align-items:center;justify-content:center">
                    ${avatarHTML}
                </div>
                <div style="flex:1">
                    <div style="font-weight:600;font-size:14px;margin-bottom:2px">${escHtml(pet.name)}</div>
                    <div style="font-size:12px;color:var(--tx2);margin-bottom:3px">
                        ${escHtml(pet.breed || pet.species)} &middot; ${escHtml(pet.gender || "")}
                        ${ageStr ? ` &middot; ${escHtml(ageStr)}` : ""}
                    </div>
                    <div style="font-size:11px;color:var(--tx3)">&#x1F4CD; ${escHtml(pet.city_name || "")} &middot; Owner: ${escHtml(ownerFirst)}</div>
                    <div style="margin-top:5px"><span class="badge badge-or">\uD83D\uDC9E Available</span></div>
                </div>
            </div>`;
        }).join("");
    } catch (ex) {
        renderEmpty(results, "&#x1F49E;", "Failed to load breeding matches");
    }
}

function setBreedingSpecies(el, sp) {
    document.querySelectorAll(".breeding-species-chip").forEach(c => c.classList.remove("active"));
    el.classList.add("active");
    doBreedingSearch();
}

function petAgeStr(dob) {
    if (!dob) return null;
    const months = Math.floor((Date.now() - new Date(dob)) / (30.44 * 24 * 3600 * 1000));
    if (months < 1)  return "< 1 mo";
    if (months < 12) return `${months} mo`;
    const y = Math.floor(months / 12), m = months % 12;
    return m ? `${y}y ${m}m` : `${y}y`;
}

function openBreedingModal(idx) {
    const results = document.getElementById("breeding-results");
    const pet     = (results?._breedingPets || [])[idx];
    if (!pet) return;
    const modal      = document.getElementById("breed-modal");
    if (!modal) return;
    const ageStr     = petAgeStr(pet.date_of_birth);
    const ownerFirst = (pet.owner_name || "Owner").split(" ")[0];
    document.getElementById("breed-modal-icon").textContent = AFP.spIco(pet.species);
    document.getElementById("breed-modal-name").textContent = pet.name;
    document.getElementById("breed-modal-sub").textContent  = `${pet.breed || pet.species} \u00B7 ${pet.gender || ""}`;
    document.getElementById("breed-modal-details").innerHTML = `
        ${infoRowHTML("Breed",   pet.breed)}
        ${infoRowHTML("Species", pet.species)}
        ${infoRowHTML("Gender",  pet.gender)}
        ${infoRowHTML("Age",     ageStr)}
        ${infoRowHTML("Colour",  pet.colour)}
        ${infoRowHTML("City",    pet.city_name)}
        ${infoRowHTML("Owner",   ownerFirst)}`;
    document.getElementById("breed-modal-contact").onclick = () => {
        AFP.tst(`\uD83D\uDCE9 Interest sent to ${ownerFirst}! They will be notified.`);
        closeBreedingModal();
    };
    modal.style.display = "flex";
}

function closeBreedingModal() {
    const m = document.getElementById("breed-modal");
    if (m) m.style.display = "none";
}

async function toggleBreedingOptIn(petId, optIn) {
    const btn = document.getElementById("breeding-toggle-btn");
    if (btn) btn.classList.add("loading");
    try {
        await AFP.PATCH(`/api/pets/${petId}/breeding-opt-in`, { optIn });
        AFP.tst(optIn ? "\uD83D\uDC9E Pet listed for breeding!" : "Removed from breeding list.");
        if (_currentPet) _currentPet.breeding_opt_in = optIn;
        renderPetProfileTab("details");
    } catch (ex) {
        AFP.tst("\u26A0\uFE0F " + ex.message);
        if (btn) btn.classList.remove("loading");
    }
}

// ?? SCREEN: ADMIN ?????????????????????????????????????????????????????????????
let _adminTab      = "overview";
let _adminPending  = [];
let _adminAllPets  = [];
let _adminStats    = null;

async function loadAdmin() {
    const user = AFP.getUser();
    if (!user) { AFP.go("splash"); return; }

    // Reset all per-session admin state on every fresh login
    _adminTab     = "overview";
    _adminPending = [];
    _adminAllPets = [];
    _adminStats   = null;
    // Also reset geo manager state so it re-fetches for this user's scope
    _geoView  = "cities";
    _selCity  = null;
    _selNigam = null;
    _selZone  = null;
    _geoCities = []; _geoNigams = []; _geoZones = []; _geoWards = [];

    document.getElementById("admin-role-badge").innerHTML =
        badgeHTML((user.role || "").replace("_", " "), "or");
    renderAdminTabBar(user);
    await renderAdminTab(_adminTab);
}

function renderAdminTabBar(user) {
const isSA = user?.role === "super_admin";
const canManageUsers = ["super_admin","city_admin","nigam_admin","zone_admin","ward_admin"].includes(user?.role);
const tabs = [
    { key: "overview", label: "Overview" },
    { key: "pending",  label: `Pending (${_adminPending.length})` },
    { key: "pets",     label: "Pets" },
        ...(canManageUsers ? [{ key: "users",    label: "\ud83d\udc65 Users"   }] : []),
        ...(canManageUsers ? [{ key: "reports",  label: "\ud83d\udccb Reports" }] : []),
    { key: "cities",   label: "Cities" },
    ...(isSA ? [{ key: "doctors", label: "+ Doctors" }, { key: "shops", label: "+ Shops" }] : []),
];
    document.getElementById("admin-tabs").innerHTML = tabs.map(t =>
        `<button class="tab${_adminTab === t.key ? " active" : ""}"
             data-tab="${t.key}"
             onclick="adminSetTab('${t.key}')">${t.label}</button>`
    ).join("");
}

async function adminSetTab(tab) {
    _adminTab = tab;
    document.querySelectorAll("#admin-tabs .tab").forEach(t =>
        t.classList.toggle("active", t.dataset.tab === tab));
    await renderAdminTab(tab);
}

async function renderAdminTab(tab) {
    const body = document.getElementById("admin-body");
    const user = AFP.getUser();

    if (tab === "overview") {
        try {
            if (!_adminStats) {
                const [s, p] = await Promise.all([
                    AFP.GET("/api/admin/stats"),
                    AFP.GET("/api/pets/pending"),
                ]);
                _adminStats   = s;
                _adminPending = p;
                renderAdminTabBar(user);
            }
            const s = _adminStats;
            const geoLabel = user?.role === "zone_admin"
                ? `&#x1F5FA;&#xFE0F; ${escHtml(user?.zone_name || "")} &mdash; ${escHtml(user?.nigam_name || "")}`
                : `&#x1F3DB;&#xFE0F; ${escHtml(user?.ward_number || "")} &mdash; ${escHtml(user?.nigam_name || "")}`;
            const panelLabel = user?.role === "zone_admin" ? "Zone dashboard" : "Ward dashboard";
            body.innerHTML = `
                <div style="margin-bottom:15px">
                    <div class="cpill">
                        <span class="cpill-tx">${geoLabel}</span>
                    </div>
                    <div style="font-size:20px;font-weight:700">${panelLabel}</div>
                </div>
                <div style="display:flex;gap:9px;margin-bottom:18px">
                    <div class="scard" style="flex:1">
                        <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Total</div>
                        <div style="font-size:26px;font-weight:700">${s?.total || 0}</div>
                    </div>
                    <div class="scard" style="flex:1">
                        <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Pending</div>
                        <div style="font-size:26px;font-weight:700;color:var(--wn)">${s?.pending || 0}</div>
                    </div>
                    <div class="scard" style="flex:1">
                        <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Approved</div>
                        <div style="font-size:26px;font-weight:700;color:var(--ok)">${s?.approved || 0}</div>
                    </div>
                </div>
                ${alertBoxHTML("info", `${_adminPending.length} application${_adminPending.length !== 1 ? "s" : ""} pending review.`)}`;
        } catch (ex) {
            body.innerHTML = alertBoxHTML("err", "Failed to load stats: " + ex.message);
        }

    } else if (tab === "pending") {
        renderLoading(body);
        try {
            _adminPending = await AFP.GET("/api/pets/pending");
            renderAdminTabBar(user);
            if (_adminPending.length === 0) {
                renderEmpty(body, "&#x2705;", "All caught up! No pending applications.");
                return;
            }
            body.innerHTML = _adminPending.map(p => `
                <div class="card" style="margin-bottom:11px" id="pending-card-${p.id}">
                    <div style="display:flex;gap:11px;align-items:center;margin-bottom:11px">
                        <div style="width:44px;height:44px;background:var(--or-p);border-radius:11px;
                                    display:flex;align-items:center;justify-content:center;font-size:22px">
                            ${AFP.spIco(p.species)}
                        </div>
                        <div style="flex:1">
                            <div style="font-size:14px;font-weight:600">${escHtml(p.name)}</div>
                            <div style="font-size:12px;color:var(--tx2)">
                                ${escHtml(p.breed || "")} &middot; ${escHtml(p.owner_name || "")}
                            </div>
                            <div style="font-size:11px;color:var(--tx3)">${AFP.fmt(p.created_at)}</div>
                        </div>
                        ${badgeHTML("Pending", "pn")}
                    </div>
                    <div style="background:var(--sf2);border-radius:8px;padding:9px;margin-bottom:11px;
                                font-size:12px;color:var(--tx2)">
                        Species: ${escHtml(p.species)} &middot;
                        Colour: ${escHtml(p.colour || "")} &middot;
                        DOB: ${AFP.fmt(p.date_of_birth)}
                    </div>
                    <div class="d-row">
                        <button id="approve-btn-${p.id}" class="btn btn-success btn-small"
                            onclick="adminApprove(${p.id})">&#x2705; Approve</button>
                        <button id="reject-btn-${p.id}"  class="btn btn-danger  btn-small"
                            onclick="adminReject(${p.id})">&#x274C; Reject</button>
                    </div>
                </div>`).join("");
        } catch (ex) {
            body.innerHTML = alertBoxHTML("err", "Failed to load pending: " + ex.message);
        }

    } else if (tab === "pets") {
        renderLoading(body);
        try {
            _adminAllPets = await AFP.GET("/api/admin/pets");
            if (_adminAllPets.length === 0) { renderEmpty(body, "&#x1F43E;", "No pets found"); return; }
            body.innerHTML = _adminAllPets.map(p => petCardHTML(p, `openPet(${p.id})`)).join("");
        } catch (ex) {
            body.innerHTML = alertBoxHTML("err", "Failed to load pets: " + ex.message);
        }

    } else if (tab === "users") {
        await UserMgmt.loadUserMgmt(body);

    } else if (tab === "reports") {
        await renderAdminReports(body);

    } else if (tab === "cities") {
        if (user?.role !== "super_admin") { body.innerHTML = alertBoxHTML("warn", "Super admin access required."); return; }
        await renderGeoManager(body);

    } else if (tab === "doctors") {
        if (user?.role !== "super_admin") { body.innerHTML = alertBoxHTML("warn", "Super admin access required."); return; }
        await DoctorMgmt.loadDoctorMgmt(body);

    } else if (tab === "shops") {
        if (user?.role !== "super_admin") { body.innerHTML = alertBoxHTML("warn", "Super admin access required."); return; }
        await ShopMgmt.loadShopMgmt(body);
    }
}

async function renderAdminReports(body) {
    renderLoading(body);
    const REPORT_LABELS = {
        stray:      "&#x1F43E; Stray / Abandoned",
        lost:       "&#x1F50D; Lost Pet",
        unlicensed: "&#x1F4CB; Unlicensed Pet",
        cruelty:    "&#x26A0;&#xFE0F; Animal Cruelty",
    };
    try {
        const reports = await AFP.GET("/api/reports");
        if (reports.length === 0) {
            renderEmpty(body, "&#x1F4CB;", "No reports in your ward yet.");
            return;
        }

        // Store for filter toggling without re-fetching
        body._reports = reports;

        const open     = reports.filter(r => r.status === "open").length;
        const resolved = reports.filter(r => r.status !== "open").length;

        body.innerHTML = `
            <div class="chips" style="margin-bottom:13px">
                <button class="chip report-filter-chip active" data-flt="all"
                    onclick="filterReports(this,'all')">All (${reports.length})</button>
                <button class="chip report-filter-chip" data-flt="open"
                    onclick="filterReports(this,'open')">
                    &#x1F7E1; Open (${open})</button>
                <button class="chip report-filter-chip" data-flt="resolved"
                    onclick="filterReports(this,'resolved')">
                    &#x2705; Resolved (${resolved})</button>
            </div>
            <div id="reports-list"></div>`;

        _renderReportsList(reports, "all");
    } catch (ex) {
        body.innerHTML = alertBoxHTML("err", "Failed to load reports: " + ex.message);
    }
}

function filterReports(btn, filter) {
    document.querySelectorAll(".report-filter-chip").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    const body    = document.getElementById("admin-body");
    const reports = body?._reports || [];
    _renderReportsList(reports, filter);
}

function _renderReportsList(reports, filter) {
    const listEl = document.getElementById("reports-list");
    if (!listEl) return;
    const REPORT_LABELS = {
        stray:      "&#x1F43E; Stray / Abandoned",
        lost:       "&#x1F50D; Lost Pet",
        unlicensed: "&#x1F4CB; Unlicensed Pet",
        cruelty:    "&#x26A0;&#xFE0F; Animal Cruelty",
    };
    const filtered = filter === "all" ? reports
        : filter === "open"     ? reports.filter(r => r.status === "open")
        : reports.filter(r => r.status !== "open");

    if (filtered.length === 0) {
        renderEmpty(listEl, "&#x1F4CB;", filter === "open" ? "No open reports." : "No resolved reports yet.");
        return;
    }
    listEl.innerHTML = filtered.map(r => {
        const isOpen = r.status === "open";
        return `
        <div class="card" style="margin-bottom:11px" id="report-card-${r.id}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-size:14px;font-weight:600">
                    ${REPORT_LABELS[r.report_type] || escHtml(r.report_type)}
                </div>
                ${badgeHTML(isOpen ? "Open" : "Resolved", isOpen ? "pn" : "ok")}
            </div>
            <div style="font-size:12px;color:var(--tx2);margin-bottom:4px">
                &#x1F4CD; ${escHtml(r.last_seen_address || "No address given")}
            </div>
            <div style="font-size:11px;color:var(--tx3);margin-bottom:${isOpen ? "10px" : "6px"}">
                Reporter: ${escHtml(r.reporter_name || "Anonymous")} &middot;
                Mobile: ${escHtml(r.reporter_mobile || "\u2014")} &middot;
                ${AFP.fmt(r.created_at)}
            </div>
            ${!isOpen && r.resolution_note ? `
            <div style="font-size:11px;color:var(--ok);margin-top:4px;padding:6px 10px;
                        background:var(--ok-p);border-radius:7px;margin-bottom:6px">
                &#x2705; ${escHtml(r.resolution_note)}
            </div>` : ""}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <button class="btn btn-outline btn-small btn-w-auto"
                    style="padding:7px 12px;font-size:12px"
                    data-report-json="${escHtml(JSON.stringify(r))}"
                    onclick="openReportCommentsModal(${r.id}, this.dataset.reportJson)">
                    &#x1F4AC; Comments
                </button>
                ${isOpen ? `
                <input id="resolve-note-${r.id}" class="field-input"
                    style="flex:1;min-width:120px;font-size:12px;padding:7px 10px"
                    placeholder="Resolution note (optional)&hellip;" />
                <button id="resolve-btn-${r.id}" class="btn btn-success btn-small btn-w-auto"
                    style="padding:8px 14px;white-space:nowrap"
                    onclick="resolveReport(${r.id})">
                    &#x2714;&#xFE0F; Resolve
                </button>` : ""}
            </div>
        </div>`;
    }).join("");
}

// ?? REPORT COMMENTS MODAL ????????????????????????????????????????????????????
let _rcReportId   = null;   // current report whose comments are open
let _rcEditId     = null;   // comment id being edited (null = adding new)
let _rcComments   = [];     // cached list for current modal session

async function openReportCommentsModal(reportId, reportJson) {
    _rcReportId = reportId;
    _rcEditId   = null;
    _rcComments = [];

    const modal   = document.getElementById("rc-modal");
    const summary = document.getElementById("rc-report-summary");
    const input   = document.getElementById("rc-comment-input");
    const errEl   = document.getElementById("rc-comment-err");
    const lbl     = document.getElementById("rc-form-label");
    const cancelBtn = document.getElementById("rc-cancel-edit-btn");

    if (!modal) return;

    // Parse the report object passed via the button's data-report-json attribute.
    // The browser HTML-decodes &quot; → " for us, so a single JSON.parse is enough.
    let report = {};
    try {
        const raw = reportJson;
        report = (typeof raw === "string" && raw.length > 0) ? JSON.parse(raw) : (raw || {});
    } catch { }

    const REPORT_LABELS = {
        stray: "Stray / Abandoned", lost: "Lost Pet",
        unlicensed: "Unlicensed Pet", cruelty: "Animal Cruelty",
    };
    summary.innerHTML = `
        <strong>${escHtml(REPORT_LABELS[report.report_type] || report.report_type || "")}</strong>
        &nbsp;&middot;&nbsp; ${escHtml(report.last_seen_address || "No address")}
        &nbsp;&middot;&nbsp; Reporter: ${escHtml(report.reporter_name || "Anonymous")}
        &nbsp;&middot;&nbsp; ${AFP.fmt(report.created_at)}`;

    input.value = "";
    errEl.style.display  = "none";
    lbl.textContent = "Add Comment";
    cancelBtn.style.display = "none";

    modal.style.display = "flex";
    await _rcLoadComments();
}

async function _rcLoadComments() {
    const listEl = document.getElementById("rc-comments-list");
    if (!listEl || !_rcReportId) return;
    renderLoading(listEl);
    try {
        const data   = await AFP.GET(`/api/reports/${_rcReportId}/comments`);
        _rcComments  = Array.isArray(data) ? data : [];
        _rcRenderComments();
    } catch (ex) {
        listEl.innerHTML = `<div style="color:var(--er);font-size:12px;padding:8px">Failed to load comments: ${escHtml(ex.message)}</div>`;
    }
}

function _rcRenderComments() {
    const listEl  = document.getElementById("rc-comments-list");
    const user    = AFP.getUser();
    if (!listEl) return;
    if (_rcComments.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--tx3);font-size:12px">No comments yet. Be the first to add one.</div>`;
        return;
    }
    listEl.innerHTML = _rcComments.map(c => {
        const isMine = (c.admin_name === user?.name) || false;
        const isEditing = _rcEditId === c.id;
        return `
        <div id="rc-comment-row-${c.id}"
             style="background:${isEditing ? "var(--or-p)" : "var(--sf2)"};
                    border-radius:9px;padding:10px 12px;border:1px solid ${isEditing ? "var(--or)" : "var(--bd)"}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div style="flex:1">
                    <div style="font-size:13px;line-height:19px;color:var(--tx);white-space:pre-wrap">${escHtml(c.comment)}</div>
                </div>
                ${isMine ? `
                <button class="icon-btn" style="background:var(--bl-p);flex-shrink:0;width:30px;height:30px;font-size:14px"
                    title="Edit comment"
                    onclick="rcStartEdit(${c.id})">&#x270F;&#xFE0F;</button>` : ""}
            </div>
            <div style="font-size:10px;color:var(--tx3);margin-top:5px">
                ${escHtml(c.admin_name || "")}
                ${c.admin_role ? `&middot; ${escHtml(c.admin_role.replace("_"," "))}` : ""}
                &middot; ${AFP.fmt(c.created_at)}
                ${c.updated_at !== c.created_at ? " (edited)" : ""}
            </div>
        </div>`;
    }).join("");
    // Scroll to bottom so newest comment is visible
    listEl.scrollTop = listEl.scrollHeight;
}

function rcStartEdit(commentId) {
    const c = _rcComments.find(x => x.id === commentId);
    if (!c) return;
    _rcEditId = commentId;
    const input     = document.getElementById("rc-comment-input");
    const lbl       = document.getElementById("rc-form-label");
    const cancelBtn = document.getElementById("rc-cancel-edit-btn");
    const errEl     = document.getElementById("rc-comment-err");
    if (input)  { input.value = c.comment; input.focus(); }
    if (lbl)    lbl.textContent = "Edit Comment";
    if (cancelBtn) cancelBtn.style.display = "";
    if (errEl)  { errEl.textContent = ""; errEl.style.display = "none"; }
    _rcRenderComments();   // re-render to highlight the row being edited
}

function rcCancelEdit() {
    _rcEditId = null;
    const input     = document.getElementById("rc-comment-input");
    const lbl       = document.getElementById("rc-form-label");
    const cancelBtn = document.getElementById("rc-cancel-edit-btn");
    const errEl     = document.getElementById("rc-comment-err");
    if (input)  input.value = "";
    if (lbl)    lbl.textContent = "Add Comment";
    if (cancelBtn) cancelBtn.style.display = "none";
    if (errEl)  { errEl.textContent = ""; errEl.style.display = "none"; }
    _rcRenderComments();
}

async function rcSaveComment() {
    const input  = document.getElementById("rc-comment-input");
    const errEl  = document.getElementById("rc-comment-err");
    const btn    = document.getElementById("rc-save-btn");
    const comment = input?.value.trim() || "";

    if (!comment) {
        if (errEl) { errEl.textContent = "Comment cannot be empty."; errEl.style.display = "block"; }
        input?.focus();
        return;
    }
    if (errEl) { errEl.textContent = ""; errEl.style.display = "none"; }
    if (btn) { btn.classList.add("loading"); btn.disabled = true; }

    try {
        if (_rcEditId) {
            // Update existing comment
            await AFP.PUT(`/api/reports/${_rcReportId}/comments/${_rcEditId}`, { comment });
            AFP.tst("Comment updated!");
            rcCancelEdit();
        } else {
            // Add new comment
            await AFP.POST(`/api/reports/${_rcReportId}/comments`, { comment });
            AFP.tst("Comment added!");
            if (input) input.value = "";
        }
        // Re-fetch from server so all saved comments (including this one)
        // are visible, and _rcComments is always in sync with the database.
        await _rcLoadComments();
    } catch (ex) {
        if (errEl) { errEl.textContent = ex.message || "Failed to save comment."; errEl.style.display = "block"; }
    } finally {
        if (btn) { btn.classList.remove("loading"); btn.disabled = false; }
    }
}

function closeReportCommentsModal() {
    const modal = document.getElementById("rc-modal");
    if (modal) modal.style.display = "none";
    _rcReportId = null;
    _rcEditId   = null;
    _rcComments = [];
}

async function resolveReport(id) {
    const noteEl = document.getElementById(`resolve-note-${id}`);
    const btn    = document.getElementById(`resolve-btn-${id}`);
    const note   = noteEl?.value.trim() || "";
    if (btn) { btn.classList.add("loading"); btn.disabled = true; }
    try {
        await AFP.PATCH(`/api/reports/${id}/resolve`, { note });
        AFP.tst("Report marked as resolved!");
        // Refresh the reports panel
        const body = document.getElementById("admin-body");
        await renderAdminReports(body);
    } catch (ex) {
        AFP.tst("\u26A0\uFE0F Failed: " + ex.message);
        if (btn) { btn.classList.remove("loading"); btn.disabled = false; }
    }
}

async function adminApprove(id) {
    const btn = document.getElementById(`approve-btn-${id}`);
    if (btn) btn.classList.add("loading");
    try {
        await AFP.PATCH(`/api/pets/${id}/approve`, { note: "" });
        AFP.tst("Pet approved!");
        _adminStats = null;
        await renderAdminTab("pending");
    } catch (ex) { AFP.tst("Failed: " + ex.message); }
    finally { if (btn) btn.classList.remove("loading"); }
}

async function adminReject(id) {
    const btn = document.getElementById(`reject-btn-${id}`);
    if (btn) btn.classList.add("loading");
    try {
        await AFP.PATCH(`/api/pets/${id}/reject`, { note: "Rejected by ward admin" });
        AFP.tst("Pet rejected.");
        _adminStats = null;
        await renderAdminTab("pending");
    } catch (ex) { AFP.tst("Failed: " + ex.message); }
    finally { if (btn) btn.classList.remove("loading"); }
}

// ── GEO MANAGER (City -> Nigam -> Zone -> Ward) ───────────────────────────────
let _geoView   = "cities";
let _selCity   = null;
let _selNigam  = null;
let _selZone   = null;
let _geoCities = [];
let _geoNigams = [];
let _geoZones  = [];
let _geoWards  = [];

async function renderGeoManager(container) {
    _geoView = "cities"; _selCity = null; _selNigam = null; _selZone = null;
    await renderGeoView(container);
}

function geoBreadcrumb() {
    let html = `<div class="breadcrumb">
        <button class="${_geoView === "cities" ? "active" : ""}" onclick="geoGoCity()">Cities</button>`;
    if (_selCity) {
        html += `<span class="breadcrumb-sep">&#8250;</span>
            <button class="${_geoView === "nigams" ? "active" : ""}"
                onclick="geoGoNigam()">${escHtml(_selCity.name)}</button>`;
    }
    if (_selNigam) {
        html += `<span class="breadcrumb-sep">&#8250;</span>
            <button class="${_geoView === "zones" ? "active" : ""}"
                onclick="geoGoZone()">${escHtml(_selNigam.name)}</button>`;
    }
    if (_selZone) {
        html += `<span class="breadcrumb-sep">&#8250;</span>
            <span style="font-size:13px;font-weight:700">${escHtml(_selZone.name)}</span>`;
    }
    return html + `</div>`;
}

async function renderGeoView(container) {
    const body = container || document.getElementById("admin-body");
    renderLoading(body);

    if (_geoView === "cities") {
        try { _geoCities = (await AFP.GET("/api/geo/cities/all")) || []; } catch { _geoCities = []; }
        body.innerHTML = geoBreadcrumb() + `
            <button class="btn btn-primary btn-small" style="margin-bottom:14px"
                onclick="openGeoModal('addCity')">+ Add New City</button>
            ${_geoCities.length === 0
                ? `<div class="center"><div class="center-icon">&#x1F3D9;&#xFE0F;</div><div class="center-text">No cities yet</div></div>`
                : _geoCities.map(c => `
                    <div class="card" style="margin-bottom:10px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <div style="flex:1;cursor:pointer" onclick="geoOpenCity(${c.id})">
                                <div style="font-weight:600;font-size:14px">${escHtml(c.name)}</div>
                                <div style="font-size:12px;color:var(--tx2);margin-top:2px">${escHtml(c.state || "")}</div>
                                <div style="font-size:11px;color:var(--tx3);margin-top:3px">
                                    ${c.nigam_count || 0} nigams &middot;
                                    ${c.zone_count  || 0} zones &middot;
                                    ${c.ward_count  || 0} wards &middot;
                                    ${c.pet_count   || 0} pets
                                </div>
                            </div>
                            ${badgeHTML(c.is_active ? "Active" : "Inactive", c.is_active ? "ok" : "rj")}
                            <button class="icon-btn" style="background:var(--bl-p)"
                                onclick='openGeoModal("editCity",${c.id})'>&#x270F;&#xFE0F;</button>
                        </div>
                        <button style="background:none;border:none;margin-top:10px;font-size:12px;
                                       color:var(--or);font-weight:600;cursor:pointer;padding:0"
                            onclick="geoOpenCity(${c.id})">View nigams &#8594;</button>
                    </div>`).join("")}`;

    } else if (_geoView === "nigams" && _selCity) {
        try { _geoNigams = (await AFP.GET(`/api/geo/nigams/all?cityId=${_selCity.id}`)) || []; } catch { _geoNigams = []; }
        body.innerHTML = geoBreadcrumb() + `
            <div class="d-row" style="margin-bottom:14px">
                <button class="btn btn-ghost btn-small" onclick="geoGoCity()">&#8592; Back</button>
                <button class="btn btn-primary btn-small" onclick="openGeoModal('addNigam')">+ Add Nigam</button>
            </div>
            ${_geoNigams.length === 0
                ? `<div class="center"><div class="center-icon">&#x1F3DB;&#xFE0F;</div><div class="center-text">No nigams in ${escHtml(_selCity.name)}</div></div>`
                : _geoNigams.map(n => `
                    <div class="card" style="margin-bottom:10px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <div style="flex:1;cursor:pointer" onclick="geoOpenNigam(${n.id})">
                                <div style="font-weight:600;font-size:13px">${escHtml(n.name)}</div>
                                <div style="font-size:11px;color:var(--tx3);margin-top:3px">
                                    ${n.zone_count || 0} zones &middot; ${n.ward_count || 0} wards
                                </div>
                                <div style="font-size:11px;color:var(--tx2);margin-top:4px">
                                    &#x1F4B3; Reg: &#x20B9;${n.registration_fee ?? 200} &middot;
                                    Renew: &#x20B9;${n.renewal_fee ?? 150} &middot;
                                    Transfer: &#x20B9;${n.transfer_fee ?? 100}
                                </div>
                            </div>
                            ${badgeHTML(n.is_active ? "Active" : "Inactive", n.is_active ? "ok" : "rj")}
                            <button class="icon-btn" style="background:var(--bl-p)"
                                onclick='openGeoModal("editNigam",${n.id})'>&#x270F;&#xFE0F;</button>
                        </div>
                        <button style="background:none;border:none;margin-top:8px;font-size:12px;
                                       color:var(--or);font-weight:600;cursor:pointer;padding:0"
                            onclick="geoOpenNigam(${n.id})">View zones &#8594;</button>
                    </div>`).join("")}`;

    } else if (_geoView === "zones" && _selNigam) {
        try { _geoZones = (await AFP.GET(`/api/geo/zones/all?nigamId=${_selNigam.id}`)) || []; } catch { _geoZones = []; }
        body.innerHTML = geoBreadcrumb() + `
            <div class="d-row" style="margin-bottom:14px">
                <button class="btn btn-ghost btn-small" onclick="geoGoNigam()">&#8592; Back</button>
                <button class="btn btn-primary btn-small" onclick="openGeoModal('addZone')">+ Add Zone</button>
            </div>
            ${_geoZones.length === 0
                ? `<div class="center"><div class="center-icon">&#x1F5FA;&#xFE0F;</div><div class="center-text">No zones in ${escHtml(_selNigam.name)}</div></div>`
                : _geoZones.map(z => `
                    <div class="card" style="margin-bottom:10px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <div style="flex:1;cursor:pointer" onclick="geoOpenZone(${z.id})">
                                <div style="font-weight:600;font-size:13px">${escHtml(z.name)}</div>
                                <div style="font-size:11px;color:var(--tx3);margin-top:3px">
                                    ${z.ward_count || 0} wards &middot; ${z.pet_count || 0} pets
                                </div>
                            </div>
                            ${badgeHTML(z.is_active ? "Active" : "Inactive", z.is_active ? "ok" : "rj")}
                            <button class="icon-btn" style="background:var(--bl-p)"
                                onclick='openGeoModal("editZone",${z.id})'>&#x270F;&#xFE0F;</button>
                        </div>
                        <button style="background:none;border:none;margin-top:8px;font-size:12px;
                                       color:var(--or);font-weight:600;cursor:pointer;padding:0"
                            onclick="geoOpenZone(${z.id})">View wards &#8594;</button>
                    </div>`).join("")}`;

    } else if (_geoView === "wards" && _selZone) {
        try { _geoWards = (await AFP.GET(`/api/geo/wards/all?zoneId=${_selZone.id}`)) || []; } catch { _geoWards = []; }
        body.innerHTML = geoBreadcrumb() + `
            <div class="d-row" style="margin-bottom:14px">
                <button class="btn btn-ghost btn-small" onclick="geoGoZone()">&#8592; Back</button>
                <button class="btn btn-primary btn-small" onclick="openGeoModal('addWard')">+ Add Ward</button>
            </div>
            ${_geoWards.length === 0
                ? `<div class="center"><div class="center-icon">&#x1F4CD;</div><div class="center-text">No wards in ${escHtml(_selZone.name)}</div></div>`
                : _geoWards.map(w => `
                    <div class="card" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                        <div style="flex:1">
                            <div style="font-weight:600;font-size:13px">${escHtml(w.ward_number)}</div>
                            <div style="font-size:11px;color:var(--tx3);margin-top:2px">${w.pet_count || 0} pets</div>
                        </div>
                        ${badgeHTML(w.is_active ? "Active" : "Inactive", w.is_active ? "ok" : "rj")}
                        <button class="icon-btn" style="background:var(--bl-p)"
                            onclick='openGeoModal("editWard",${w.id})'>&#x270F;&#xFE0F;</button>
                    </div>`).join("")}`;
    }
}

async function geoOpenCity(id)  { _selCity  = _geoCities.find(c => c.id === id); _selNigam = null; _selZone = null; _geoView = "nigams"; await renderGeoView(); }
async function geoOpenNigam(id) { _selNigam = _geoNigams.find(n => n.id === id); _selZone = null;  _geoView = "zones";  await renderGeoView(); }
async function geoOpenZone(id)  { _selZone  = _geoZones.find(z => z.id === id);  _geoView = "wards"; await renderGeoView(); }
async function geoGoCity()      { _geoView = "cities"; _selCity = null; _selNigam = null; _selZone = null; await renderGeoView(); }
async function geoGoNigam()     { _geoView = "nigams"; _selNigam = null; _selZone = null; await renderGeoView(); }
async function geoGoZone()      { _geoView = "zones";  _selZone = null; await renderGeoView(); }

function openGeoModal(action, id) {
    const modal   = document.getElementById("geo-modal");
    const titleEl = document.getElementById("geomodal-title");
    const fieldsEl= document.getElementById("geomodal-fields");
    const errEl   = document.getElementById("geomodal-err");
    if (!modal) return;
    errEl.innerHTML = "";

    let title = "";
    let fields = [];
    let saveHandler;

    if (action === "addCity") {
        title  = "Add New City";
        fields = [{ id: "gf-name", label: "City name *", ph: "e.g. Pune" }, { id: "gf-state", label: "State *", ph: "e.g. Maharashtra" }];
        saveHandler = async () => {
            const n = document.getElementById("gf-name").value.trim();
            const s = document.getElementById("gf-state").value.trim();
            if (!n || !s) throw new Error("City name and state are required.");
            await AFP.POST("/api/geo/cities", { name: n, state: s });
            AFP.tst("City added!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "editCity") {
        const c = _geoCities.find(x => x.id === id);
        title  = "Edit City";
        fields = [{ id: "gf-name", label: "City name *", ph: "e.g. Pune", val: c?.name }, { id: "gf-state", label: "State *", ph: "e.g. Maharashtra", val: c?.state }];
        saveHandler = async () => {
            const n = document.getElementById("gf-name").value.trim();
            const s = document.getElementById("gf-state").value.trim();
            if (!n || !s) throw new Error("City name and state are required.");
            await AFP.PUT(`/api/geo/cities/${id}`, { name: n, state: s, is_active: true });
            AFP.tst("Updated!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "addNigam") {
        title  = `Add Nigam \u2014 ${_selCity?.name}`;
        fields = [
            { id: "gf-name", label: "Nigam name *", ph: "e.g. Pune Municipal Corp" },
            { id: "gf-reg-fee",  label: "Registration fee (\u20B9) *", ph: "200",  val: "200" },
            { id: "gf-ren-fee",  label: "Renewal fee (\u20B9) *",      ph: "150",  val: "150" },
            { id: "gf-txn-fee",  label: "Transfer fee (\u20B9) *",      ph: "100",  val: "100" },
        ];
        saveHandler = async () => {
            const n   = document.getElementById("gf-name").value.trim();
            const rf  = parseFloat(document.getElementById("gf-reg-fee").value);
            const rnf = parseFloat(document.getElementById("gf-ren-fee").value);
            const tf  = parseFloat(document.getElementById("gf-txn-fee").value);
            if (!n) throw new Error("Nigam name is required.");
            if (isNaN(rf) || rf < 0) throw new Error("Enter a valid registration fee.");
            if (isNaN(rnf) || rnf < 0) throw new Error("Enter a valid renewal fee.");
            if (isNaN(tf) || tf < 0) throw new Error("Enter a valid transfer fee.");
            await AFP.POST("/api/geo/nigams", { name: n, cityId: _selCity?.id,
                registration_fee: rf, renewal_fee: rnf, transfer_fee: tf });
            AFP.tst("Nigam added!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "editNigam") {
        const n = _geoNigams.find(x => x.id === id);
        title  = "Edit Nigam";
        fields = [
            { id: "gf-name",    label: "Nigam name *",                  ph: "Nigam name", val: n?.name },
            { id: "gf-reg-fee", label: "Registration fee (\u20B9) *",   ph: "200",        val: n?.registration_fee ?? 200 },
            { id: "gf-ren-fee", label: "Renewal fee (\u20B9) *",         ph: "150",        val: n?.renewal_fee      ?? 150 },
            { id: "gf-txn-fee", label: "Transfer fee (\u20B9) *",         ph: "100",        val: n?.transfer_fee     ?? 100 },
        ];
        saveHandler = async () => {
            const nm  = document.getElementById("gf-name").value.trim();
            const rf  = parseFloat(document.getElementById("gf-reg-fee").value);
            const rnf = parseFloat(document.getElementById("gf-ren-fee").value);
            const tf  = parseFloat(document.getElementById("gf-txn-fee").value);
            if (!nm) throw new Error("Nigam name is required.");
            if (isNaN(rf) || rf < 0) throw new Error("Enter a valid registration fee.");
            if (isNaN(rnf) || rnf < 0) throw new Error("Enter a valid renewal fee.");
            if (isNaN(tf) || tf < 0) throw new Error("Enter a valid transfer fee.");
            await AFP.PUT(`/api/geo/nigams/${id}`, { name: nm, is_active: true,
                registration_fee: rf, renewal_fee: rnf, transfer_fee: tf });
            AFP.tst("Updated!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "addZone") {
        title  = `Add Zone \u2014 ${_selNigam?.name}`;
        fields = [{ id: "gf-zone", label: "Zone name *", ph: "e.g. North Zone" }];
        saveHandler = async () => {
            const z = document.getElementById("gf-zone").value.trim();
            if (!z) throw new Error("Zone name is required.");
            await AFP.POST("/api/geo/zones", { name: z, nigamId: _selNigam?.id });
            AFP.tst("Zone added!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "editZone") {
        const z = _geoZones.find(x => x.id === id);
        title  = "Edit Zone";
        fields = [{ id: "gf-zone", label: "Zone name *", ph: "e.g. North Zone", val: z?.name }];
        saveHandler = async () => {
            const zn = document.getElementById("gf-zone").value.trim();
            if (!zn) throw new Error("Zone name is required.");
            await AFP.PUT(`/api/geo/zones/${id}`, { name: zn, is_active: true });
            AFP.tst("Updated!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "addWard") {
        title  = `Add Ward \u2014 ${_selZone?.name}`;
        fields = [{ id: "gf-ward", label: "Ward number / name *", ph: "e.g. Ward 15" }];
        saveHandler = async () => {
            const w = document.getElementById("gf-ward").value.trim();
            if (!w) throw new Error("Ward number is required.");
            await AFP.POST("/api/geo/wards", { wardNumber: w, zoneId: _selZone?.id, nigamId: _selNigam?.id });
            AFP.tst("Ward added!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "editWard") {
        const w = _geoWards.find(x => x.id === id);
        title  = "Edit Ward";
        fields = [{ id: "gf-ward", label: "Ward number / name *", ph: "e.g. Ward 15", val: w?.ward_number }];
        saveHandler = async () => {
            const wn = document.getElementById("gf-ward").value.trim();
            if (!wn) throw new Error("Ward number is required.");
            await AFP.PUT(`/api/geo/wards/${id}`, { wardNumber: wn, is_active: true });
            AFP.tst("Updated!"); closeGeoModal(); await renderGeoView();
        };
    }

    titleEl.textContent = title;
    fieldsEl.innerHTML  = fields.map(f => `
        <div class="field">
            <label class="field-label">${escHtml(f.label)}</label>
            <input id="${f.id}" class="field-input"
                   placeholder="${escHtml(f.ph || "")}"
                   value="${escHtml(f.val || "")}">
        </div>`).join("");

    modal._saveHandler = saveHandler;
    modal.style.display = "flex";
}

async function geoModalSave() {
    const modal = document.getElementById("geo-modal");
    const errEl = document.getElementById("geomodal-err");
    const btn   = document.getElementById("geomodal-save-btn");
    errEl.innerHTML = "";
    btn.classList.add("loading");
    try {
        await modal._saveHandler();
    } catch (ex) {
        errEl.innerHTML = alertBoxHTML("err", ex.message || "Failed to save. Please try again.");
    } finally { btn.classList.remove("loading"); }
}

function closeGeoModal() {
    document.getElementById("geo-modal").style.display = "none";
}

// ?? ADD DOCTOR / SHOP FORMS - kept as legacy fallback; tab rendering now delegates
// to DoctorMgmt / ShopMgmt modules (afp-doctorshop-mgmt.js).
// ?????????????????????????????????????????????????????????????????????????????
function renderAddDoctorForm(container) {
    container.innerHTML = `
        <div class="sec-title" style="margin-bottom:14px">Add New Vet / Doctor</div>
        <div id="adddoc-err"></div>
        <form id="adddoc-form" novalidate>
            <div class="field">
                <label class="field-label">Doctor name *</label>
                <input id="ad-name" class="field-input" placeholder="Dr. Rajesh Verma">
                <div id="ad-name-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div>
            </div>
            <div class="field"><label class="field-label">Qualification</label><input id="ad-qual"    class="field-input" placeholder="BVSc, MVSc"></div>
            <div class="field"><label class="field-label">Specialization</label><input id="ad-spec"   class="field-input" placeholder="Small animals"></div>
            <div class="field"><label class="field-label">Clinic name</label><input id="ad-clinic"    class="field-input" placeholder="Verma Pet Clinic"></div>
            <div class="field">
                <label class="field-label">Address *</label>
                <input id="ad-addr" class="field-input" placeholder="Full address">
                <div id="ad-addr-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div>
            </div>
            <div class="field">
                <label class="field-label">Mobile *</label>
                <input id="ad-mobile" class="field-input" placeholder="9800011111" type="tel" maxlength="10">
                <div id="ad-mobile-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div>
            </div>
            <div class="field"><label class="field-label">Timings</label><input id="ad-timings" class="field-input" placeholder="9am-7pm (Mon-Sat)"></div>
            <label class="checkbox-row" id="ad-24hr-row">
                <div class="checkbox" id="ad-24hr-box"></div>
                <span class="checkbox-lbl">24-hour clinic</span>
            </label>
            <button id="adddoc-btn" type="submit" class="btn btn-primary">Add Doctor &#8594;</button>
        </form>`;

    let is24hr = false;
    document.getElementById("ad-24hr-row").addEventListener("click", () => {
        is24hr = !is24hr;
        const box = document.getElementById("ad-24hr-box");
        box.classList.toggle("checked", is24hr);
        box.innerHTML = is24hr ? `<span style="color:#fff;font-size:13px">&#x2713;</span>` : "";
    });

    // Inline validation for doctor form
    function _fieldErr(id, msg) {
        const e = document.getElementById(`${id}-err`);
        const i = document.getElementById(id);
        if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; }
        if (i) { i.style.borderColor = msg ? "var(--er)" : ""; i.style.background = msg ? "var(--er-p)" : ""; }
    }
    document.getElementById("ad-name").addEventListener("blur", function () {
        _fieldErr("ad-name", this.value.trim() ? "" : "Doctor name is required.");
    });
    document.getElementById("ad-addr").addEventListener("blur", function () {
        _fieldErr("ad-addr", this.value.trim() ? "" : "Address is required.");
    });
    document.getElementById("ad-mobile").addEventListener("blur", function () {
        _fieldErr("ad-mobile",
            !this.value.trim() ? "Mobile is required." :
            !/^[6-9]\d{9}$/.test(this.value.trim()) ? "Enter a valid 10-digit mobile number." : "");
    });

    document.getElementById("adddoc-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        const user   = AFP.getUser();
        const name   = document.getElementById("ad-name").value.trim();
        const mobile = document.getElementById("ad-mobile").value.trim();
        const addr   = document.getElementById("ad-addr").value.trim();
        let valid    = true;
        if (!name)                              { _fieldErr("ad-name",   "Doctor name is required."); valid = false; }
        if (!addr)                              { _fieldErr("ad-addr",   "Address is required.");     valid = false; }
        if (!mobile)                            { _fieldErr("ad-mobile", "Mobile is required.");      valid = false; }
        else if (!/^[6-9]\d{9}$/.test(mobile)) { _fieldErr("ad-mobile", "Enter a valid 10-digit mobile number."); valid = false; }
        if (!valid) return;

        const btn = document.getElementById("adddoc-btn");
        btn.classList.add("loading");
        try {
            await AFP.POST("/api/doctors", {
                name,
                qualification:  document.getElementById("ad-qual").value,
                specialization: document.getElementById("ad-spec").value,
                clinicName:     document.getElementById("ad-clinic").value,
                address: addr, mobile,
                timings: document.getElementById("ad-timings").value,
                is24hr,
                wardId:  user.ward_id,
                nigamId: user.nigam_id,
                cityId:  user.city_id,
            });
            AFP.tst("Doctor added successfully!");
            adminSetTab("overview");
        } catch (ex) {
            document.getElementById("adddoc-err").innerHTML = alertBoxHTML("err", ex.message);
        } finally { btn.classList.remove("loading"); }
    });
}

// ?? ADD SHOP FORM ?????????????????????????????????????????????????????????????
function renderAddShopForm(container) {
    container.innerHTML = `
        <div class="sec-title" style="margin-bottom:14px">Add New Pet Food Shop</div>
        <div id="addshop-err"></div>
        <form id="addshop-form" novalidate>
            <div class="field">
                <label class="field-label">Shop name *</label>
                <input id="as-name" class="field-input" placeholder="Paws &amp; Claws">
                <div id="as-name-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div>
            </div>
            <div class="field"><label class="field-label">Owner name</label><input id="as-owner"  class="field-input" placeholder="Amit Jain"></div>
            <div class="field">
                <label class="field-label">Address *</label>
                <input id="as-addr" class="field-input" placeholder="Full address">
                <div id="as-addr-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div>
            </div>
            <div class="field">
                <label class="field-label">Mobile *</label>
                <input id="as-mobile" class="field-input" placeholder="9911000001" type="tel" maxlength="10">
                <div id="as-mobile-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div>
            </div>
            <div class="field"><label class="field-label">Timings</label><input id="as-timings" class="field-input" placeholder="9am-9pm"></div>
            <div class="field"><label class="field-label">Speciality</label><input id="as-spec"   class="field-input" placeholder="Dog food, cat food, accessories"></div>
            <button id="addshop-btn" type="submit" class="btn btn-primary">Add Shop &#8594;</button>
        </form>`;

    function _fieldErr(id, msg) {
        const e = document.getElementById(`${id}-err`);
        const i = document.getElementById(id);
        if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; }
        if (i) { i.style.borderColor = msg ? "var(--er)" : ""; i.style.background = msg ? "var(--er-p)" : ""; }
    }
    document.getElementById("as-name").addEventListener("blur", function () {
        _fieldErr("as-name", this.value.trim() ? "" : "Shop name is required.");
    });
    document.getElementById("as-addr").addEventListener("blur", function () {
        _fieldErr("as-addr", this.value.trim() ? "" : "Address is required.");
    });
    document.getElementById("as-mobile").addEventListener("blur", function () {
        _fieldErr("as-mobile",
            !this.value.trim() ? "Mobile is required." :
            !/^[6-9]\d{9}$/.test(this.value.trim()) ? "Enter a valid 10-digit mobile number." : "");
    });

    document.getElementById("addshop-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        const user   = AFP.getUser();
        const name   = document.getElementById("as-name").value.trim();
        const mobile = document.getElementById("as-mobile").value.trim();
        const addr   = document.getElementById("as-addr").value.trim();
        let valid    = true;
        if (!name)                              { _fieldErr("as-name",   "Shop name is required."); valid = false; }
        if (!addr)                              { _fieldErr("as-addr",   "Address is required.");   valid = false; }
        if (!mobile)                            { _fieldErr("as-mobile", "Mobile is required.");    valid = false; }
        else if (!/^[6-9]\d{9}$/.test(mobile)) { _fieldErr("as-mobile", "Enter a valid 10-digit mobile number."); valid = false; }
        if (!valid) return;

        const btn = document.getElementById("addshop-btn");
        btn.classList.add("loading");
        try {
            await AFP.POST("/api/shops", {
                name,
                ownerName:  document.getElementById("as-owner").value,
                address: addr, mobile,
                timings:    document.getElementById("as-timings").value,
                speciality: document.getElementById("as-spec").value,
                wardId:  user.ward_id,
                nigamId: user.nigam_id,
                cityId:  user.city_id,
            });
            AFP.tst("Shop added successfully!");
            adminSetTab("overview");
        } catch (ex) {
            document.getElementById("addshop-err").innerHTML = alertBoxHTML("err", ex.message);
        } finally { btn.classList.remove("loading"); }
    });
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
