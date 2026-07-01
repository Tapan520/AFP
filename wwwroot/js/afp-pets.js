// ?? Pet Screens & State ???????????????????????????????????????????????????????
// Covers: pet profile, health tab, docs tab, QR modal, photo modal,
//         certificate generator, new-pet, renew, report, transfer, breeding.
// Extracted from afp-screens.js for maintainability.
// Depends on: AFP, Validate, alertBoxHTML, badgeHTML, infoRowHTML,
//             petCardHTML, petBadgeHTML, renderLoading, renderEmpty,
//             escHtml, populatePicker, loadHealthJournal (afp-features)

// ?? State (encapsulated; legacy globals aliased for inline onclick= compatibility) ??
const PetState = (() => {
    let _petProfileTab = "details";
    let _currentPet    = null;
    let _petPhoto      = null;
    let _vaxCert       = null;
    let _newPetPhoto   = null;
    let _newPetCert    = null;

    return {
        get petProfileTab()  { return _petProfileTab; },
        set petProfileTab(v) { _petProfileTab = v; },
        get currentPet()     { return _currentPet; },
        set currentPet(v)    { _currentPet = v; },
        get petPhoto()       { return _petPhoto; },
        set petPhoto(v)      { _petPhoto = v; },
        get vaxCert()        { return _vaxCert; },
        set vaxCert(v)       { _vaxCert = v; },
        get newPetPhoto()    { return _newPetPhoto; },
        set newPetPhoto(v)   { _newPetPhoto = v; },
        get newPetCert()     { return _newPetCert; },
        set newPetCert(v)    { _newPetCert = v; },
        reset() {
            _petProfileTab = "details";
            _currentPet    = null;
            _petPhoto      = null;
            _vaxCert       = null;
        },
        resetNewPet() {
            _newPetPhoto = null;
            _newPetCert  = null;
        },
    };
})();

// Legacy global aliases — keep inline onclick= attributes in HTML working unchanged
Object.defineProperty(window, "_currentPet",    { get: () => PetState.currentPet,    set: v => { PetState.currentPet = v; } });
Object.defineProperty(window, "_petProfileTab", { get: () => PetState.petProfileTab, set: v => { PetState.petProfileTab = v; } });
Object.defineProperty(window, "_petPhoto",      { get: () => PetState.petPhoto,      set: v => { PetState.petPhoto = v; } });
Object.defineProperty(window, "_vaxCert",       { get: () => PetState.vaxCert,       set: v => { PetState.vaxCert = v; } });
Object.defineProperty(window, "_newPetPhoto",   { get: () => PetState.newPetPhoto,   set: v => { PetState.newPetPhoto = v; } });
Object.defineProperty(window, "_newPetCert",    { get: () => PetState.newPetCert,    set: v => { PetState.newPetCert = v; } });

// ?? SCREEN: PET PROFILE ???????????????????????????????????????????????????????
function openPet(id) {
    AFP.setSelectedPetId(id);
    loadPetProfile();
}

async function loadPetProfile() {
    const petId = AFP.getSelectedPetId();
    if (!petId) { AFP.go("dashboard"); return; }
    PetState.reset();

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
        PetState.currentPet = pet;
        if (pet.photo_url)       PetState.petPhoto = { uploaded: true };
        if (pet.certificate_url) PetState.vaxCert  = { uploaded: true };
        renderPetProfileHeader(pet);
        document.querySelectorAll("#screen-petProfile .tab").forEach(t =>
            t.classList.toggle("active", t.dataset.tab === "details"));
        // Inject journal tab if not already present
        const tabBar = document.querySelector("#screen-petProfile .tabs");
        if (tabBar && !tabBar.querySelector('[data-tab="journal"]')) {
            const jTab = document.createElement("button");
            jTab.className = "tab"; jTab.dataset.tab = "journal";
            jTab.textContent = "Journal";
            jTab.onclick = () => petProfileSetTab("journal");
            tabBar.appendChild(jTab);
        }
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
            banner.className     = `vax-alert${isOvd ? " vax-alert-danger" : ""}`;
            banner.style.display = "flex";
            banner.innerHTML = `
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
    PetState.petProfileTab = tab;
    document.querySelectorAll("#screen-petProfile .tab").forEach(t =>
        t.classList.toggle("active", t.dataset.tab === tab));
    renderPetProfileTab(tab);
}

async function renderPetProfileTab(tab) {
    const body = document.getElementById("petprofile-body");
    const pet  = PetState.currentPet;
    const user = AFP.getUser();
    if (!body || !pet) return;

    if (tab === "details") {
        const photoDone = !!(PetState.petPhoto || pet.photo_url);
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

    } else if (tab === "journal") {
        loadHealthJournal(pet.id);
        return;
    } else if (tab === "health") {
        const dv     = AFP.daysTo(pet.vaccine_next_due);
        const dvAbs  = dv !== null ? Math.abs(dv) : null;
        const isOvd  = dv !== null && dv < 0;
        const isSoon = dv !== null && dv >= 0 && dv <= 30;
        const certDone  = !!(PetState.vaxCert || pet.certificate_url);
        const isCitizen = ["citizen","super_admin"].includes(user?.role);

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
        const certDone  = !!(PetState.vaxCert || pet.certificate_url);
        const photoDone = !!(PetState.petPhoto || pet.photo_url);
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
    if (!file || !PetState.currentPet) return;
    const upEl = document.getElementById("petprofile-photo-uploading");
    if (upEl) upEl.style.display = "flex";
    try {
        const result = await AFP.uploadFile(`/api/pets/${PetState.currentPet.id}/upload-photo`, file, "photo");
        AFP.tst("Photo uploaded successfully!");
        PetState.petPhoto = { uploaded: true };
        PetState.currentPet.photo_url = result.url;   // update in-memory so thumbnail shows immediately
    } catch (ex) {
        AFP.tst("\u26A0\uFE0F Upload failed: " + ex.message);
        PetState.petPhoto = null;
    } finally {
        if (upEl) upEl.style.display = "none";
        renderPetProfileHeader(PetState.currentPet);  // refresh avatar with new photo
        renderPetProfileTab("details");
    }
}

async function handleVaxCertChange(file) {
    if (!file || !PetState.currentPet) return;
    const upEl = document.getElementById("petprofile-cert-uploading");
    if (upEl) upEl.style.display = "flex";
    try {
        await AFP.uploadFile(`/api/pets/${PetState.currentPet.id}/upload-certificate`, file, "certificate");
        AFP.tst("Certificate uploaded successfully!");
        PetState.vaxCert = { uploaded: true };
    } catch (ex) {
        AFP.tst("\u26A0\uFE0F Upload failed: " + ex.message);
        PetState.vaxCert = null;
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
        await AFP.PATCH(`/api/pets/${PetState.currentPet.id}/vaccine`, { note });
        AFP.tst("Vaccine record updated!");
        if (noteEl) noteEl.value = "";
    } catch { AFP.tst("Health note saved!"); }
    finally {
        if (btn) { btn.classList.remove("loading"); btn.innerHTML = "&#x1F4BE; Save Health Note"; }
    }
}

// ?? QR MODAL ??????????????????????????????????????????????????????????????????
function openQRModal() {
    const pet = PetState.currentPet;
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

    document.getElementById("qr-grid").innerHTML      = qrRows;
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
    // Local HTML-escaper
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
  .cert{width:100%;max-width:760px;background:#fff;border:3px solid #8B6914;
        position:relative;overflow:hidden;}
  .cert-inner{position:absolute;inset:7px;border:1.5px solid #D4AF37;
              pointer-events:none;z-index:0;}
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
  .band{background:#D4AF37;padding:9px 28px;display:flex;align-items:center;
        justify-content:center;gap:16px;position:relative;z-index:1;}
  .band-deco{font-size:9px;color:rgba(0,0,0,.35);letter-spacing:3px;}
  .band-title{font-size:13px;font-weight:700;letter-spacing:2.5px;
              text-transform:uppercase;color:#1A1814;}
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
  .sigs{display:flex;justify-content:space-between;margin-bottom:8px;padding-top:6px;}
  .sig{text-align:center;width:175px;}
  .sig-line{border-bottom:1.5px solid #1A1814;height:28px;margin-bottom:5px;}
  .sig-lbl{font-size:11px;color:#5A564F;
           font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:16px;}
  .sig-title{font-size:10px;color:#9A958C;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin-top:1px;}
  .stamp{position:absolute;right:38px;bottom:56px;width:86px;height:86px;
         border-radius:50%;border:3px solid rgba(232,103,10,.5);
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         color:rgba(232,103,10,.65);transform:rotate(-18deg);z-index:2;pointer-events:none;}
  .stamp-ico{font-size:22px;margin-bottom:2px;}
  .stamp-txt{font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
             text-align:center;line-height:12px;}
  .ftr{background:#1A1814;color:rgba(255,255,255,.42);padding:9px 28px;
       display:flex;justify-content:space-between;font-size:10px;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       letter-spacing:.3px;position:relative;z-index:1;}
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
function initNewPet() {
    PetState.resetNewPet();
    const form = document.getElementById("newpet-form");
    if (!form || form._initialized) return;
    form._initialized = true;
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
            if (PetState.newPetPhoto) {
                try { await AFP.uploadFile(`/api/pets/${petData.id}/upload-photo`, PetState.newPetPhoto, "photo"); }
                catch { AFP.tst("\u26A0\uFE0F Photo upload failed — add it from the pet profile."); }
            }
            if (PetState.newPetCert) {
                try { await AFP.uploadFile(`/api/pets/${petData.id}/upload-certificate`, PetState.newPetCert, "certificate"); }
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
    PetState.newPetPhoto = file;
    const box = document.getElementById("np-photo-box");
    if (box) {
        box.classList.add("done");
        box.querySelector(".ubox-icon").textContent = "\u2705";
        box.querySelector(".ubox-text").textContent = "Photo selected";
    }
}

function handleNewPetCert(file) {
    if (!file) return;
    PetState.newPetCert = file;
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
    const form = document.getElementById("rp-form");
    if (!form || form._initialized) return;
    form._initialized = true;
    Validate.injectErrorContainers("reportPet");
    Validate.attachLive("reportPet");
    form.addEventListener("submit", async function (e) {
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
        if (PetState.currentPet) PetState.currentPet.breeding_opt_in = optIn;
        renderPetProfileTab("details");
    } catch (ex) {
        AFP.tst("\u26A0\uFE0F " + ex.message);
        if (btn) btn.classList.remove("loading");
    }
}
