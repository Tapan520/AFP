// ????????????????????????????????????????????????????????????????????????????????
// ?  AFP FEATURES — 10 New Modules                                               ?
// ?  1. Notification Center     6. Emergency Vet Finder                          ?
// ?  2. Vaccination Reminders   7. Microchip Lookup                              ?
// ?  3. Pet Adoption Center     8. Community Events                              ?
// ?  4. Lost & Found Board      9. Vet & Shop Ratings                            ?
// ?  5. Pet Health Journal     10. Analytics Dashboard                           ?
// ????????????????????????????????????????????????????????????????????????????????

// ??? MODULE 1: NOTIFICATION CENTER ???????????????????????????????????????????

function _notifKey() { return `afp_notifs_${AFP.getUser()?.id || 0}`; }
function _getNotifs() { try { return JSON.parse(localStorage.getItem(_notifKey()) || "[]"); } catch { return []; } }
function _saveNotifs(n) { try { localStorage.setItem(_notifKey(), JSON.stringify(n)); } catch { } }

async function generateNotifications() {
    const notifs = _getNotifs();
    const seen   = new Set(notifs.map(n => n.id));
    const newN   = [];
    try {
        const pets = await AFP.GET("/api/pets/my");
        for (const pet of pets) {
            const dv = AFP.daysTo(pet.vaccine_next_due);
            if (dv !== null) {
                const nid = `vax_${pet.id}_${pet.vaccine_next_due}`;
                if (!seen.has(nid)) {
                    newN.push({
                        id: nid,
                        type:  dv < 0 ? "vax_overdue" : "vax_due",
                        icon:  "&#x1F489;",
                        title: dv < 0 ? `${pet.name} \u2014 Vaccine OVERDUE!` : `${pet.name} \u2014 Vaccine Due Soon`,
                        body:  dv < 0 ? `Overdue by ${Math.abs(dv)} days. Please visit a vet.`
                                      : `Due in ${dv} day${dv === 1 ? "" : "s"} (${AFP.fmt(pet.vaccine_next_due)})`,
                        petId: pet.id, ts: Date.now(), read: false,
                    });
                }
            }
            const dl = AFP.daysTo(pet.licence_expiry_date);
            if (dl !== null && dl <= 30) {
                const nid = `lic_${pet.id}_${pet.licence_expiry_date}`;
                if (!seen.has(nid)) {
                    newN.push({
                        id: nid,
                        type: dl < 0 ? "lic_expired" : "lic_expiring",
                        icon: "&#x1F4C4;",
                        title: `${pet.name} \u2014 Licence ${dl < 0 ? "Expired" : "Expiring"}`,
                        body:  dl < 0 ? `Licence expired ${Math.abs(dl)} days ago. Renew now.`
                                      : `Expires in ${dl} day${dl === 1 ? "" : "s"}.`,
                        petId: pet.id, ts: Date.now(), read: false,
                    });
                }
            }
            if (pet.registration_status === "approved" && !seen.has(`approved_${pet.id}`)) {
                newN.push({ id: `approved_${pet.id}`, type: "approved", icon: "&#x2705;",
                    title: `${pet.name} \u2014 Approved!`,
                    body: "Your pet registration has been approved by the ward officer.",
                    petId: pet.id, ts: Date.now(), read: false });
            }
            if (pet.registration_status === "rejected" && !seen.has(`rejected_${pet.id}`)) {
                newN.push({ id: `rejected_${pet.id}`, type: "rejected", icon: "&#x274C;",
                    title: `${pet.name} \u2014 Rejected`,
                    body: `Registration rejected. ${pet.admin_note ? "Note: " + pet.admin_note : "Contact your ward office."}`,
                    petId: pet.id, ts: Date.now(), read: false });
            }
        }
    } catch { }
    if (newN.length > 0) _saveNotifs([...newN, ...notifs].slice(0, 50));
    updateNotificationBadge();
}

function updateNotificationBadge() {
    const unread = _getNotifs().filter(n => !n.read).length;
    const badge  = document.getElementById("notif-badge");
    if (!badge) return;
    badge.textContent    = unread > 9 ? "9+" : String(unread);
    badge.style.display  = unread > 0 ? "flex" : "none";
}

async function loadNotifications() {
    const body = document.getElementById("notif-body");
    if (!body) return;
    await generateNotifications();
    const notifs = _getNotifs();
    if (notifs.length === 0) { renderEmpty(body, "&#x1F514;", "No notifications yet"); return; }
    const TYPE_COLOR = { vax_overdue: "var(--er)", vax_due: "var(--wn)",
                         lic_expired: "var(--er)", lic_expiring: "var(--wn)",
                         approved: "var(--ok)", rejected: "var(--er)" };
    body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px 6px">
            <div style="font-size:13px;color:var(--tx2)">${notifs.filter(n => !n.read).length} unread</div>
            <button class="btn btn-ghost btn-small btn-w-auto" style="padding:5px 12px"
                onclick="markAllNotifsRead()">Mark all read</button>
        </div>
        ${notifs.map(n => `
        <div class="notif-item${n.read ? "" : " unread"}"
             onclick="readNotif('${escHtml(n.id)}',${n.petId || 0})">
            <div class="notif-icon" style="color:${TYPE_COLOR[n.type] || "var(--or)"}">${n.icon || "&#x1F514;"}</div>
            <div style="flex:1;min-width:0">
                <div style="font-weight:${n.read ? "500" : "700"};font-size:13px;color:var(--tx);margin-bottom:2px">
                    ${escHtml(n.title)}
                </div>
                <div style="font-size:12px;color:var(--tx2);line-height:17px">${escHtml(n.body)}</div>
                <div style="font-size:10px;color:var(--tx3);margin-top:3px">${_timeAgo(n.ts)}</div>
            </div>
            ${!n.read ? `<div class="notif-dot"></div>` : ""}
        </div>`).join("")}`;
}

function readNotif(id, petId) {
    const notifs = _getNotifs();
    const n = notifs.find(x => x.id === id);
    if (n) { n.read = true; _saveNotifs(notifs); }
    updateNotificationBadge();
    if (petId) { AFP.setSelectedPetId(petId); loadPetProfile(); }
    else loadNotifications();
}

function markAllNotifsRead() {
    const notifs = _getNotifs();
    notifs.forEach(n => n.read = true);
    _saveNotifs(notifs);
    updateNotificationBadge();
    loadNotifications();
}

function _timeAgo(ts) {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

// ??? MODULE 2: VACCINATION REMINDERS ??????????????????????????????????????????

async function loadVaccineReminders() {
    const body = document.getElementById("vax-reminder-body");
    if (!body) return;
    renderLoading(body);
    try {
        const pets = await AFP.GET("/api/pets/my");
        const withDue = pets
            .filter(p => p.vaccine_next_due)
            .map(p => ({ ...p, dv: AFP.daysTo(p.vaccine_next_due) }))
            .sort((a, b) => a.dv - b.dv);

        if (withDue.length === 0) {
            body.innerHTML = `<div class="p-18">${alertBoxHTML("info", "No vaccine due dates recorded. Upload vaccination certificates from each pet's Health tab to start tracking.")}</div>${bottomNavHTML("home")}`;      
            return;
        }

        const overdueCount = withDue.filter(p => p.dv < 0).length;
        const dueCount     = withDue.filter(p => p.dv >= 0 && p.dv <= 30).length;

        body.innerHTML = `
            <div class="p-18" style="padding-bottom:8px">
                ${overdueCount > 0 ? alertBoxHTML("err", `${overdueCount} pet${overdueCount > 1 ? "s" : ""} have OVERDUE vaccinations!`) : ""}
                ${dueCount > 0    ? alertBoxHTML("warn", `${dueCount} pet${dueCount > 1 ? "s" : ""} due within 30 days.`) : ""}
                ${overdueCount === 0 && dueCount === 0 ? alertBoxHTML("ok", "All pets are up to date!") : ""}
            </div>
            <div style="padding:0 18px">
            ${withDue.map(pet => {
                const isOvd  = pet.dv < 0;
                const isSoon = pet.dv >= 0 && pet.dv <= 14;
                const color  = isOvd ? "var(--er)" : isSoon ? "var(--wn)" : "var(--ok)";
                const bg     = isOvd ? "var(--er-p)" : isSoon ? "var(--wn-p)" : "var(--ok-p)";
                const label  = isOvd ? `${Math.abs(pet.dv)}d OVERDUE`
                             : pet.dv === 0 ? "Due TODAY" : `Due in ${pet.dv}d`;
                return `
                <div class="card" style="cursor:pointer;border-left:4px solid ${color}"
                     onclick="openPet(${pet.id})">
                    <div style="display:flex;align-items:center;gap:12px">
                        <div style="width:46px;height:46px;border-radius:13px;background:${bg};
                                    display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">
                            ${AFP.spIco(pet.species)}
                        </div>
                        <div style="flex:1">
                            <div style="font-weight:700;font-size:14px">${escHtml(pet.name)}</div>
                            <div style="font-size:12px;color:var(--tx2);margin-top:2px">
                                ${escHtml(pet.breed || pet.species)} &middot; ${AFP.fmt(pet.vaccine_next_due)}
                            </div>
                        </div>
                        <span style="background:${bg};color:${color};font-weight:700;
                                     font-size:11px;padding:4px 9px;border-radius:999px;white-space:nowrap">
                            ${label}
                        </span>
                    </div>
                    <div style="margin-top:10px;display:flex;gap:8px">
                        <button class="btn btn-outline btn-small" style="flex:1"
                            onclick="event.stopPropagation();AFP.go('searchDoctor')">
                            &#x1FA7A; Book Vet
                        </button>
                        <button class="btn btn-ghost btn-small" style="flex:1"
                            onclick="event.stopPropagation();openPet(${pet.id})">
                            &#x1F4CB; Pet Profile
                        </button>
                    </div>
                </div>`;
            }).join("")}
            </div>
            ${bottomNavHTML("home")}`;
    } catch (ex) {
        body.innerHTML = `<div class="p-18">${alertBoxHTML("err", "Failed to load: " + ex.message)}</div>${bottomNavHTML("home")}`;
    }
}

// ??? MODULE 3: PET ADOPTION CENTER ????????????????????????????????????????????

let _adoptionPets = [];

async function loadAdoption() {
    const body = document.getElementById("adoption-body");
    if (!body) return;
    renderLoading(body);
    try {
        let data;
        try { data = await AFP.GET("/api/pets/adoption"); }
        catch { data = await AFP.GET("/api/pets/breeding?"); }
        _adoptionPets = data;
        if (data.length === 0) {
            renderEmpty(body, "&#x1F43E;", "No pets available for adoption right now.\nCheck back soon!");
            return;
        }
        body.innerHTML = `
            <div style="padding:12px 18px 6px;font-size:13px;color:var(--tx2)">
                ${data.length} pet${data.length !== 1 ? "s" : ""} looking for a home
            </div>
            ${data.map((pet, i) => `
            <div style="margin:0 18px 14px">
                <div style="border-radius:16px;overflow:hidden;border:1px solid var(--bd);background:#fff">
                    ${pet.photo_url && pet.photo_url.startsWith("/")
                        ? `<img src="${escHtml(pet.photo_url)}" alt="${escHtml(pet.name)}"
                               style="width:100%;height:160px;object-fit:cover;display:block"
                               onerror="this.style.display='none'">`
                        : `<div style="height:110px;background:var(--or-p);display:flex;align-items:center;
                                       justify-content:center;font-size:52px">${AFP.spIco(pet.species)}</div>`}
                    <div style="padding:14px">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                            <div style="font-size:17px;font-weight:700">${escHtml(pet.name)}</div>
                            ${badgeHTML("Available", "ok")}
                        </div>
                        <div style="font-size:13px;color:var(--tx2);margin-bottom:6px">
                            ${escHtml(pet.breed || pet.species)} &middot; ${escHtml(pet.gender || "")}
                            ${petAgeStr(pet.date_of_birth) ? ` &middot; ${petAgeStr(pet.date_of_birth)}` : ""}
                        </div>
                        <div style="font-size:12px;color:var(--tx3);margin-bottom:12px">
                            &#x1F4CD; ${escHtml(pet.city_name || "")}, ${escHtml(pet.ward_number || "")}
                        </div>
                        <button class="btn btn-primary" onclick="openAdoptionModal(${i})">
                            &#x1F43E; Express Interest
                        </button>
                    </div>
                </div>
            </div>`).join("")}`;
    } catch { renderEmpty(body, "&#x26A0;&#xFE0F;", "Failed to load adoption listings."); }
}

function openAdoptionModal(idx) {
    const pet   = _adoptionPets[idx];
    const modal = document.getElementById("adoption-modal");
    if (!pet || !modal) return;
    document.getElementById("adoption-modal-name").textContent     = pet.name;
    document.getElementById("adoption-modal-details").innerHTML    = `
        ${infoRowHTML("Species", pet.species)}
        ${infoRowHTML("Breed",   pet.breed)}
        ${infoRowHTML("Gender",  pet.gender)}
        ${infoRowHTML("Age",     petAgeStr(pet.date_of_birth))}
        ${infoRowHTML("City",    pet.city_name)}
        ${infoRowHTML("Contact", (pet.owner_name || "").split(" ")[0] + " (via AFP)")}`;
    document.getElementById("adoption-interest-btn").onclick = () => {
        AFP.tst(`&#x1F43E; Interest sent for ${pet.name}! The owner will be notified.`);
        closeAdoptionModal();
    };
    modal.style.display = "flex";
}

function closeAdoptionModal() {
    const m = document.getElementById("adoption-modal");
    if (m) m.style.display = "none";
}

// ??? MODULE 4: LOST & FOUND BOARD ?????????????????????????????????????????????

let _lfTab = "all";

async function loadLostFound() {
    _lfTab = "all";
    await _renderLostFound();
}

async function _renderLostFound() {
    const body = document.getElementById("lostfound-body");
    if (!body) return;
    renderLoading(body);
    try {
        const reports = await AFP.GET("/api/reports");
        const relevant = reports.filter(r => ["lost","stray","cruelty"].includes(r.report_type));
        const shown    = _lfTab === "all" ? relevant
            : relevant.filter(r => r.report_type === _lfTab);

        const tabs = `
        <div class="chips" style="padding:12px 18px 0">
            <button class="chip${_lfTab === "all"    ? " active" : ""}" onclick="setLFTab('all')">
                All (${relevant.length})</button>
            <button class="chip${_lfTab === "lost"   ? " active" : ""}" onclick="setLFTab('lost')">
                &#x1F50D; Lost</button>
            <button class="chip${_lfTab === "stray"  ? " active" : ""}" onclick="setLFTab('stray')">
                &#x1F43E; Stray</button>
            <button class="chip${_lfTab === "cruelty"? " active" : ""}" onclick="setLFTab('cruelty')">
                &#x26A0;&#xFE0F; Cruelty</button>
        </div>`;

        if (shown.length === 0) {
            body.innerHTML = tabs + `<div class="center" style="margin-top:32px">
                <div class="center-icon">&#x1F50D;</div>
                <div class="center-text">No reports in this category</div>
            </div>
            <div style="padding:16px 18px">
                <button class="btn btn-primary" onclick="AFP.go('reportPet')">+ Report a Pet</button>
            </div>`;
            return;
        }

        body.innerHTML = tabs + `
        <div style="padding:12px 18px">
            ${shown.map(r => `
            <div class="card" style="margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <div style="font-weight:700;font-size:13px">
                        ${{ lost:"&#x1F50D; Lost Pet", stray:"&#x1F43E; Stray Pet", cruelty:"&#x26A0;&#xFE0F; Animal Cruelty" }[r.report_type] || escHtml(r.report_type)}
                    </div>
                    ${badgeHTML(r.status === "open" ? "Open" : "Resolved", r.status === "open" ? "pn" : "ok")}
                </div>
                <div style="font-size:13px;color:var(--tx);margin-bottom:5px">
                    &#x1F4CD; ${escHtml(r.last_seen_address || "Address not given")}
                </div>
                <div style="font-size:11px;color:var(--tx3)">
                    Reporter: ${escHtml(r.reporter_name || "Anonymous")} &middot; ${AFP.fmt(r.created_at)}
                </div>
                ${r.status === "open" ? `
                <button class="btn btn-outline btn-small" style="margin-top:10px"
                    onclick="AFP.tst('&#x1F4DE; Connecting you to the reporter...')">
                    &#x1F4DE; Contact Reporter
                </button>` : ""}
            </div>`).join("")}
        </div>
        <div style="padding:0 18px 24px">
            <button class="btn btn-primary" onclick="AFP.go('reportPet')">
                + Report a Lost or Stray Pet
            </button>
        </div>`;
    } catch { body.innerHTML = `<div class="p-18">${alertBoxHTML("err", "Failed to load reports.")}</div>`; }
}

function setLFTab(tab) { _lfTab = tab; _renderLostFound(); }

// ??? MODULE 5: PET HEALTH JOURNAL ?????????????????????????????????????????????

function _jKey(petId) { return `afp_journal_${petId}`; }
function _getJournal(petId) { try { return JSON.parse(localStorage.getItem(_jKey(petId)) || "[]"); } catch { return []; } }
function _saveJournal(petId, e) { try { localStorage.setItem(_jKey(petId), JSON.stringify(e)); } catch { } }

function loadHealthJournal(petId) {
    const body = document.getElementById("petprofile-body");
    if (!body || !petId) return;
    const entries = _getJournal(petId);
    const ICONS   = { vet_visit: "&#x1F3E5;", vaccination: "&#x1F489;", medication: "&#x1F48A;", grooming: "&#x2702;&#xFE0F;", weight: "&#x2696;&#xFE0F;", note: "&#x1F4DD;" };

    body.innerHTML = `
        <div class="card" style="margin-bottom:14px">
            <div style="font-weight:700;font-size:14px;margin-bottom:12px">&#x1F4DD; Add Journal Entry</div>
            <div class="field">
                <label class="field-label">Entry type</label>
                <select id="jentry-type" class="field-input">
                    <option value="vet_visit">&#x1F3E5; Vet Visit</option>
                    <option value="vaccination">&#x1F489; Vaccination</option>
                    <option value="medication">&#x1F48A; Medication</option>
                    <option value="grooming">&#x2702;&#xFE0F; Grooming</option>
                    <option value="weight">&#x2696;&#xFE0F; Weight Check</option>
                    <option value="note">&#x1F4DD; General Note</option>
                </select>
            </div>
            <div class="field">
                <label class="field-label">Date</label>
                <input id="jentry-date" class="field-input" type="date"
                    value="${new Date().toISOString().split("T")[0]}">
            </div>
            <div class="field">
                <label class="field-label">Notes *</label>
                <textarea id="jentry-note" class="field-input" rows="3"
                    placeholder="e.g. Annual vaccination done by Dr. Verma. Next due Jan 2026."></textarea>
            </div>
            <button class="btn btn-primary btn-small" onclick="saveJournalEntry(${petId})">
                &#x1F4BE; Add Entry
            </button>
        </div>
        <div class="sec-title" style="margin-bottom:12px">
            ${entries.length} Journal ${entries.length === 1 ? "Entry" : "Entries"}
        </div>
        ${entries.length === 0
            ? `<div class="center" style="padding:24px">
                <div class="center-icon">&#x1F4D6;</div>
                <div class="center-text">No entries yet. Start tracking your pet&rsquo;s health!</div>
               </div>`
            : entries.slice().reverse().map(e => `
            <div class="journal-entry">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
                    <span style="font-size:20px">${ICONS[e.type] || "&#x1F4DD;"}</span>
                    <div style="flex:1">
                        <div style="font-weight:600;font-size:13px;text-transform:capitalize">
                            ${e.type.replace("_", " ")}
                        </div>
                        <div style="font-size:11px;color:var(--tx3)">${AFP.fmt(e.date)}</div>
                    </div>
                </div>
                <div style="font-size:13px;color:var(--tx2);line-height:19px;padding-left:30px">
                    ${escHtml(e.note)}
                </div>
            </div>`).join("")}`;
}

function saveJournalEntry(petId) {
    const type = document.getElementById("jentry-type")?.value;
    const date = document.getElementById("jentry-date")?.value;
    const note = document.getElementById("jentry-note")?.value.trim();
    if (!note) { AFP.tst("&#x26A0;&#xFE0F; Please enter a note."); return; }
    const entries = _getJournal(petId);
    entries.push({ id: Date.now(), type, date: date || new Date().toISOString().split("T")[0], note, ts: Date.now() });
    _saveJournal(petId, entries);
    AFP.tst("&#x1F4DD; Journal entry saved!");
    loadHealthJournal(petId);
}

// ??? MODULE 6: EMERGENCY VET FINDER ??????????????????????????????????????????

async function loadEmergencyVet() {
    const body = document.getElementById("emergency-body");
    if (!body) return;
    renderLoading(body);
    const user = AFP.getUser();
    try {
        const doctors = await AFP.GET(`/api/doctors?cityId=${user?.city_id || ""}`);
        const hrs24   = doctors.filter(d => d.is_24hr);
        const regular = doctors.filter(d => !d.is_24hr);

        body.innerHTML = `
            <div style="margin:14px 18px 4px">
                <div class="alert-box alert-err">
                    <span>&#x1F6A8;</span>
                    <p><strong>Emergency Hotline:</strong> 1962 (Animal Helpline) &nbsp;|&nbsp; 1800-200-1232</p>
                </div>
            </div>
            <div style="padding:6px 18px">
                <div class="sec-title" style="margin-bottom:12px">
                    &#x1F3E5; 24-Hour Emergency Clinics (${hrs24.length})
                </div>
                ${hrs24.length === 0 ? alertBoxHTML("warn", "No 24-hour clinics listed in your city yet.") :
                  hrs24.map(d => _emergencyCard(d, true)).join("")}
            </div>
            <div style="padding:4px 18px">
                <div class="sec-title" style="margin-bottom:12px">Nearby Clinics (${regular.length})</div>
                ${regular.length === 0 ? alertBoxHTML("info", "No clinics found. Try a different city.") :
                  regular.slice(0, 6).map(d => _emergencyCard(d, false)).join("")}
            </div>
            ${bottomNavHTML("home")}`;
    } catch {
        body.innerHTML = `<div class="p-18">
            ${alertBoxHTML("err", "Could not load clinic data.")}
            ${alertBoxHTML("info", "Emergency: 1962 (Animal Helpline)")}
        </div>${bottomNavHTML("home")}`;
    }
}

function _emergencyCard(d, is24) {
    return `
    <div class="dir-card" style="margin-bottom:10px${is24 ? ";border:2px solid var(--er)" : ""}">
        <div class="dir-card-avatar" style="background:var(--bl-p)">&#x1F3E5;</div>
        <div style="flex:1">
            <div style="font-weight:700;font-size:14px">${escHtml(d.name)}</div>
            <div style="font-size:12px;color:var(--tx2)">${escHtml(d.clinic_name || "")}</div>
            <div style="font-size:11px;color:var(--tx3);margin-top:2px">
                &#x1F4CD; ${escHtml(d.address || d.city_name || "")}
                ${d.timings ? ` &middot; &#x23F0; ${escHtml(d.timings)}` : ""}
            </div>
            ${is24 ? `<span class="badge" style="background:var(--er-p);color:var(--er);margin-top:5px">
                &#x1F534; 24hr Emergency</span>` : ""}
        </div>
        <button class="btn btn-primary btn-small btn-w-auto" style="padding:8px 12px;flex-shrink:0"
            onclick="AFP.tst('&#x1F4DE; Calling ${escHtml(d.name)}...')">
            &#x1F4DE;
        </button>
    </div>`;
}

// ??? MODULE 7: MICROCHIP LOOKUP ???????????????????????????????????????????????

function loadMicrochip() {
    const body = document.getElementById("microchip-body");
    if (!body) return;
    body.innerHTML = `
        <div class="p-18">
            <div class="alert-box alert-info">
                <span>&#x2139;&#xFE0F;</span>
                <p>Enter a microchip ID, official Pet ID (e.g. JPC-0001), or owner name to look up a pet record.</p>
            </div>
            <div class="field" style="margin-top:6px">
                <label class="field-label">Microchip ID / Pet ID / Name</label>
                <div class="search-wrap">
                    <span class="search-icon">&#x1F50D;</span>
                    <input id="microchip-q" class="field-input" style="padding-left:34px"
                        placeholder="e.g. AFP-0001 or 985141002614898"
                        oninput="doMicrochipSearch()" />
                </div>
            </div>
            <div id="microchip-results" style="margin-top:8px"></div>
        </div>`;
}

async function doMicrochipSearch() {
    const q       = document.getElementById("microchip-q")?.value.trim() || "";
    const results = document.getElementById("microchip-results");
    if (!results) return;
    if (q.length < 3) { results.innerHTML = ""; return; }
    renderLoading(results);
    try {
        const user = AFP.getUser();
        const data = await AFP.GET(`/api/pets/search?q=${encodeURIComponent(q)}&cityId=${user?.city_id || ""}`);
        if (data.length === 0) {
            results.innerHTML = alertBoxHTML("warn", "No pet found with this ID. The pet may not be registered.");
            return;
        }
        results.innerHTML = `<div style="font-size:13px;color:var(--ok);font-weight:600;margin-bottom:8px">
            &#x2705; ${data.length} record${data.length > 1 ? "s" : ""} found
        </div>` + data.slice(0, 5).map(p => petCardHTML(p, `openPet(${p.id})`)).join("");
    } catch { results.innerHTML = alertBoxHTML("err", "Search failed. Please try again."); }
}

// ??? MODULE 8: COMMUNITY EVENTS ???????????????????????????????????????????????

function _evKey() { return "afp_events_v2"; }

function _getEvents() {
    try {
        const s = JSON.parse(localStorage.getItem(_evKey()) || "[]");
        if (s.length > 0) return s;
    } catch { }
    const now = Date.now(), d = 86400000;
    const seed = [
        { id: 1, type: "vaccination", icon: "&#x1F489;", title: "Free Vaccination Camp",
          date: new Date(now + 3 * d).toISOString().split("T")[0],
          location: "Central Park, Jaipur", organizer: "Jaipur Municipal Corp",
          desc: "Free rabies & combo vaccination for dogs and cats. Bring your pet\u2019s health card.", spots: 50 },
        { id: 2, type: "adoption", icon: "&#x1F43E;", title: "Pet Adoption Drive",
          date: new Date(now + 7 * d).toISOString().split("T")[0],
          location: "City Hall Grounds, Delhi", organizer: "Delhi SPCA",
          desc: "Find your forever companion! 40+ pets looking for loving homes.", spots: null },
        { id: 3, type: "meetup", icon: "&#x1F415;", title: "Dog Owners Meetup",
          date: new Date(now + 10 * d).toISOString().split("T")[0],
          location: "Lodhi Garden, Delhi", organizer: "Delhi Pet Lovers Club",
          desc: "Monthly meetup for dog owners. Come socialize \u2014 all breeds welcome!", spots: null },
        { id: 4, type: "awareness", icon: "&#x1F4E2;", title: "Pet Licensing Awareness Camp",
          date: new Date(now + 14 * d).toISOString().split("T")[0],
          location: "Ward 7 Community Hall, Mumbai", organizer: "MCGM",
          desc: "Learn about pet licensing and register on-the-spot.", spots: 100 },
    ];
    try { localStorage.setItem(_evKey(), JSON.stringify(seed)); } catch { }
    return seed;
}

async function loadEvents() {
    const body  = document.getElementById("events-body");
    if (!body) return;
    const user   = AFP.getUser();
    const isAdmin = user && user.role !== "citizen";
    const events  = _getEvents();
    const TYPE_BG = { vaccination: "#EBF3FF", adoption: "#FFF3E8", meetup: "#D1FAE5", awareness: "#FEF3C7" };

    body.innerHTML = `
        <div style="padding:12px 18px 6px;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:13px;color:var(--tx2)">${events.length} upcoming events</div>
            ${isAdmin ? `<button class="btn btn-primary btn-small btn-w-auto"
                onclick="openAddEventModal()">+ Add Event</button>` : ""}
        </div>
        ${events.map(ev => `
        <div style="margin:0 18px 14px">
            <div style="border-radius:14px;overflow:hidden;border:1px solid var(--bd);background:#fff">
                <div style="background:${TYPE_BG[ev.type] || "var(--sf2)"};padding:14px 14px 10px;
                            display:flex;align-items:center;gap:10px">
                    <div style="font-size:26px">${ev.icon}</div>
                    <div>
                        <div style="font-weight:700;font-size:14px">${escHtml(ev.title)}</div>
                        <div style="font-size:12px;color:var(--tx2)">${escHtml(ev.organizer)}</div>
                    </div>
                </div>
                <div style="padding:12px 14px">
                    <div style="display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap">
                        <div style="font-size:12px;color:var(--tx2)">&#x1F4C5; ${AFP.fmt(ev.date)}</div>
                        <div style="font-size:12px;color:var(--tx2)">&#x1F4CD; ${escHtml(ev.location)}</div>
                    </div>
                    <div style="font-size:13px;color:var(--tx);line-height:19px;margin-bottom:10px">
                        ${escHtml(ev.desc)}
                    </div>
                    ${ev.spots ? `<div style="font-size:12px;color:var(--ok);font-weight:600;margin-bottom:8px">
                        &#x2705; ${ev.spots} spots available</div>` : ""}
                    <button class="btn btn-primary btn-small"
                        onclick="AFP.tst('&#x2705; RSVP confirmed for ${escHtml(ev.title)}!')">
                        &#x2705; RSVP
                    </button>
                </div>
            </div>
        </div>`).join("")}
        ${bottomNavHTML("home")}`;
}

function openAddEventModal() {
    const m = document.getElementById("event-add-modal");
    if (m) m.style.display = "flex";
}

function closeAddEventModal() {
    const m = document.getElementById("event-add-modal");
    if (m) m.style.display = "none";
}

function saveNewEvent() {
    const title    = document.getElementById("ev-title")?.value.trim();
    const date     = document.getElementById("ev-date")?.value;
    const location = document.getElementById("ev-location")?.value.trim();
    const desc     = document.getElementById("ev-desc")?.value.trim();
    const type     = document.getElementById("ev-type")?.value || "meetup";
    if (!title || !date || !location) { AFP.tst("&#x26A0;&#xFE0F; Title, date and location are required."); return; }
    const ICONS = { vaccination: "&#x1F489;", adoption: "&#x1F43E;", meetup: "&#x1F415;", awareness: "&#x1F4E2;" };
    const events = _getEvents();
    events.unshift({ id: Date.now(), type, icon: ICONS[type] || "&#x1F4C5;",
        title, date, location, desc: desc || "",
        organizer: AFP.getUser()?.name || "Municipal Corp", spots: null });
    try { localStorage.setItem(_evKey(), JSON.stringify(events)); } catch { }
    AFP.tst(`&#x1F4C5; Event &ldquo;${title}&rdquo; created!`);
    closeAddEventModal();
    loadEvents();
}

// ??? MODULE 9: VET & SHOP RATINGS ?????????????????????????????????????????????

function _myRatingKey(type, id)  { return `afp_myr_${type}_${id}_${AFP.getUser()?.id || 0}`; }
function _allRatingsKey(type, id){ return `afp_allr_${type}_${id}`; }

function getMyRating(type, id) {
    try { return parseInt(localStorage.getItem(_myRatingKey(type, id)) || "0"); } catch { return 0; }
}

function getAvgRating(type, id) {
    try {
        const all = JSON.parse(localStorage.getItem(_allRatingsKey(type, id)) || "[]");
        if (!all.length) return null;
        return { avg: (all.reduce((s, r) => s + r, 0) / all.length).toFixed(1), count: all.length };
    } catch { return null; }
}

function submitRating(type, id, stars) {
    try { localStorage.setItem(_myRatingKey(type, id), String(stars)); } catch { }
    try {
        const all = JSON.parse(localStorage.getItem(_allRatingsKey(type, id)) || "[]");
        all.push(stars);
        localStorage.setItem(_allRatingsKey(type, id), JSON.stringify(all.slice(-200)));
    } catch { }
    AFP.tst(`&#x2B50; Rated ${stars} star${stars !== 1 ? "s" : ""}!`);
    renderStarWidget(`stars-${type}-${id}`, type, id);
}

function renderStarWidget(containerId, type, id) {
    const el  = document.getElementById(containerId);
    if (!el) return;
    const my  = getMyRating(type, id);
    const avg = getAvgRating(type, id);
    el.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-top:10px;padding-top:10px;
                    border-top:1px solid var(--bd)">
            <div style="display:flex;gap:1px">
                ${[1,2,3,4,5].map(s => `<span style="font-size:22px;cursor:pointer;
                    color:${s <= my ? "#F59E0B" : "#D1D5DB"};transition:color .1s"
                    onmouseover="this.style.color='#F59E0B'"
                    onmouseout="this.style.color='${s <= my ? "#F59E0B" : "#D1D5DB"}'"
                    onclick="submitRating('${type}',${id},${s})">&#x2605;</span>`).join("")}
            </div>
            <span style="font-size:12px;color:var(--tx2)">
                ${avg ? `${avg.avg} avg (${avg.count} rating${avg.count !== 1 ? "s" : ""})` :
                        `Rate this ${type === "doc" ? "vet" : "shop"}`}
            </span>
        </div>`;
}

function addRatingToModal(type, id, containerId) {
    // Defer slightly to ensure modal DOM is ready
    setTimeout(() => renderStarWidget(containerId, type, id), 60);
}

// Add average rating badge to dir-cards in doctor/shop search results
function ratingBadgeHTML(type, id) {
    const avg = getAvgRating(type, id);
    if (!avg) return "";
    const stars = Math.round(+avg.avg);
    return `<span style="font-size:11px;color:#92400E;background:#FEF3C7;padding:2px 7px;
                border-radius:999px;font-weight:600;white-space:nowrap">
        ${"&#x2B50;".repeat(stars)} ${avg.avg}
    </span>`;
}

// ??? MODULE 10: ANALYTICS DASHBOARD ??????????????????????????????????????????

async function renderAnalyticsDashboard(body) {
    if (!body) return;
    renderLoading(body);
    try {
        const [stats, allPets] = await Promise.all([
            AFP.GET("/api/admin/stats"),
            AFP.GET("/api/admin/pets").catch(() => []),
        ]);

        const species = { dog:0, cat:0, rabbit:0, bird:0, other:0 };
        allPets.forEach(p => {
            const s = ["dog","cat","rabbit","bird"].includes(p.species) ? p.species : "other";
            species[s]++;
        });
        const maxSp = Math.max(...Object.values(species), 1);

        const statuses = { approved:0, pending:0, rejected:0 };
        allPets.forEach(p => { if (statuses[p.registration_status] !== undefined) statuses[p.registration_status]++; });

        const monthLabels = [], monthCounts = [];
        for (let i = 5; i >= 0; i--) {
            const d  = new Date(); d.setMonth(d.getMonth() - i);
            const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
            monthLabels.push(d.toLocaleDateString("en-IN", { month: "short" }));
            monthCounts.push(allPets.filter(p => (p.created_at || "").startsWith(ym)).length);
        }
        const maxM = Math.max(...monthCounts, 1);

        body.innerHTML = `
        <div class="p-18">
            <div style="font-size:17px;font-weight:700;margin-bottom:16px">&#x1F4CA; Analytics Overview</div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
                <div class="scard"><div class="scard-icon">&#x1F43E;</div>
                    <div class="scard-val">${allPets.length}</div><div class="scard-lbl">Total Pets</div></div>
                <div class="scard"><div class="scard-icon">&#x2705;</div>
                    <div class="scard-val">${statuses.approved}</div><div class="scard-lbl">Approved</div></div>
                <div class="scard"><div class="scard-icon">&#x23F3;</div>
                    <div class="scard-val">${statuses.pending}</div><div class="scard-lbl">Pending</div></div>
                <div class="scard"><div class="scard-icon">&#x1F3D9;&#xFE0F;</div>
                    <div class="scard-val">${stats?.total || 0}</div><div class="scard-lbl">This Ward</div></div>
            </div>

            <div class="sec-title" style="margin-bottom:12px">&#x1F4C8; Monthly Registrations (Last 6 Months)</div>
            <div class="card">
                <div style="display:flex;align-items:flex-end;gap:6px;height:110px;padding:4px 0">
                    ${monthLabels.map((lbl, i) => `
                    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
                        <div style="font-size:10px;color:var(--tx3);font-weight:600">${monthCounts[i]}</div>
                        <div style="width:100%;background:var(--or);border-radius:4px 4px 0 0;min-height:4px;
                                    height:${Math.max(4, Math.round(monthCounts[i] / maxM * 80))}px"></div>
                        <div style="font-size:10px;color:var(--tx2)">${lbl}</div>
                    </div>`).join("")}
                </div>
            </div>

            <div class="sec-title" style="margin:14px 0 12px">&#x1F43E; Species Distribution</div>
            <div class="card">
                ${[["&#x1F436;","dog","Dogs"],["&#x1F431;","cat","Cats"],["&#x1F430;","rabbit","Rabbits"],["&#x1F426;","bird","Birds"],["&#x1F43E;","other","Others"]].map(([ic, k, lbl]) => `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
                    <span style="font-size:16px;width:22px;text-align:center">${ic}</span>
                    <span style="font-size:12px;color:var(--tx2);width:56px">${lbl}</span>
                    <div style="flex:1;background:var(--sf2);border-radius:4px;height:9px;overflow:hidden">
                        <div style="height:100%;background:var(--or);border-radius:4px;
                                    width:${Math.round(species[k] / maxSp * 100)}%"></div>
                    </div>
                    <span style="font-size:12px;font-weight:700;color:var(--tx);width:20px;text-align:right">
                        ${species[k]}
                    </span>
                </div>`).join("")}
            </div>

            <div class="sec-title" style="margin:14px 0 12px">&#x1F4CB; Approval Status</div>
            <div class="card">
                <div style="display:flex;justify-content:space-around;text-align:center;padding:6px 0">
                    ${[["&#x2705;","Approved","var(--ok)",statuses.approved],
                       ["&#x23F3;","Pending","var(--wn)",statuses.pending],
                       ["&#x274C;","Rejected","var(--er)",statuses.rejected]].map(([ic, lbl, c, cnt]) => `
                    <div>
                        <div style="font-size:28px;margin-bottom:4px">${ic}</div>
                        <div style="font-size:22px;font-weight:700;color:${c}">${cnt}</div>
                        <div style="font-size:11px;color:var(--tx2)">${lbl}</div>
                    </div>`).join("")}
                </div>
            </div>
        </div>`;
    } catch (ex) {
        body.innerHTML = alertBoxHTML("err", "Failed to load analytics: " + ex.message);
    }
}
