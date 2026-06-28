// ?? AFP DOCTOR & SHOP MANAGEMENT MODULE ????????????????????????????????????
// Full CRUD (List / Add / Edit / Delete) for Doctors and Pet-Food Shops.
// Super-admin only. Geo-filtered: City ? Nigam ? Ward.
// Local routes (/api/admin/doctors, /api/admin/shops) proxy to Railway backend.
// ????????????????????????????????????????????????????????????????????????????

// ?? DOCTOR MANAGEMENT ????????????????????????????????????????????????????????
const DoctorMgmt = (() => {

    // ?? State ????????????????????????????????????????????????????????????????
    let _search    = "";
    let _cityId    = "";
    let _nigamId   = "";
    let _zoneId    = "";
    let _wardId    = "";
    let _doctors   = [];
    let _cities    = [];
    let _editDoc   = null;
    let _container = null;

    // ?? Local proxy helper ????????????????????????????????????????????????????
    async function _api(method, path, body) {
        const token   = AFP.getToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res  = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || "Request failed");
        return data;
    }

    // ?? Entry point ???????????????????????????????????????????????????????????
    async function loadDoctorMgmt(container) {
        _container = container || document.getElementById("admin-body");
        _search = ""; _cityId = ""; _nigamId = ""; _zoneId = ""; _wardId = "";
        if (!_container) return;
        try { _cities = await AFP.GET("/api/geo/cities"); } catch { _cities = []; }
        _renderFrame();
        await _loadDoctors();
    }

    function _renderFrame() {
        const cityOpts = _cities.map(c =>
            `<option value="${c.id}">${escHtml(c.name)}</option>`
        ).join("");

        _container.innerHTML = `
            <div class="um-header">
                <div style="font-size:17px;font-weight:700">&#x1FA7A; Doctor / Vet Management</div>
                <button class="btn btn-primary btn-small btn-w-auto"
                        onclick="DoctorMgmt.openModal(null)"
                        style="padding:9px 14px">+ Add Doctor</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
                <select id="dm-city-flt" class="field-input"
                        style="flex:1;min-width:110px;font-size:13px"
                        onchange="DoctorMgmt.onCityFilter(this.value)">
                    <option value="">&#x1F3D9;&#xFE0F; All Cities</option>
                    ${cityOpts}
                </select>
                <select id="dm-nigam-flt" class="field-input"
                        style="flex:1;min-width:110px;font-size:13px;display:none"
                        onchange="DoctorMgmt.onNigamFilter(this.value)">
                    <option value="">&#x1F3DB;&#xFE0F; All Nigams</option>
                </select>
                <select id="dm-zone-flt" class="field-input"
                        style="flex:1;min-width:110px;font-size:13px;display:none"
                        onchange="DoctorMgmt.onZoneFilter(this.value)">
                    <option value="">&#x1F5FA;&#xFE0F; All Zones</option>
                </select>
                <select id="dm-ward-flt" class="field-input"
                        style="flex:1;min-width:110px;font-size:13px;display:none"
                        onchange="DoctorMgmt.onWardFilter(this.value)">
                    <option value="">&#x1F4CD; All Wards</option>
                </select>
            </div>
            <div class="search-wrap" style="margin-bottom:13px">
                <span class="search-icon">&#x1F50D;</span>
                <input id="dm-search" class="field-input" style="padding-left:34px"
                    placeholder="Search by name, clinic or mobile&hellip;"
                    oninput="DoctorMgmt.onSearch(this.value)" />
            </div>
            <div id="dm-list"></div>`;
    }

    async function _loadDoctors() {
        const listEl = document.getElementById("dm-list");
        if (!listEl) return;
        renderLoading(listEl);
        try {
            const p = new URLSearchParams();
            if (_cityId)  p.set("cityId",  _cityId);
            if (_nigamId) p.set("nigamId", _nigamId);
            if (_zoneId)  p.set("zoneId",  _zoneId);
            if (_wardId)  p.set("wardId",  _wardId);
            if (_search)  p.set("q",       _search);
            _doctors = await _api("GET", `/api/admin/doctors?${p}`);
            _renderList(listEl);
        } catch (ex) {
            listEl.innerHTML = alertBoxHTML("err", "Failed to load doctors: " + ex.message);
        }
    }

    function _renderList(listEl) {
        if (!_doctors || _doctors.length === 0) {
            renderEmpty(listEl, "&#x1FA7A;", "No doctors / vets found");
            return;
        }
        listEl.innerHTML = _doctors.map(d => {
            const geo = [d.ward_number, d.nigam_name, d.city_name].filter(Boolean).map(escHtml).join(" &middot; ");
            return `
            <div class="card um-card" id="dm-card-${d.id}">
                <div style="display:flex;align-items:center;gap:12px">
                    <div class="um-avatar" style="background:var(--bl-p)">&#x1F468;&#x200D;&#x2695;&#xFE0F;</div>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:14px">${escHtml(d.name || "\u2014")}</div>
                        <div style="font-size:12px;color:var(--tx2);margin-top:2px">
                            ${d.clinic_name ? `${escHtml(d.clinic_name)} &middot; ` : ""}${escHtml(d.mobile || "")}
                        </div>
                        ${geo ? `<div style="font-size:11px;color:var(--tx3);margin-top:2px">&#x1F4CD; ${geo}</div>` : ""}
                        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">
                            ${d.specialization ? badgeHTML(d.specialization, "in") : ""}
                            ${d.qualification  ? badgeHTML(d.qualification,  "pn") : ""}
                            ${d.is_24hr        ? badgeHTML("24 hr Clinic",   "ok") : ""}
                        </div>
                        ${d.timings ? `<div style="font-size:11px;color:var(--tx3);margin-top:4px">&#x1F552; ${escHtml(d.timings)}</div>` : ""}
                    </div>
                    <div class="um-actions">
                        <button class="icon-btn" style="background:var(--bl-p)" title="Edit"
                            onclick="DoctorMgmt.openModal(${d.id})">&#x270F;&#xFE0F;</button>
                        <button class="icon-btn" style="background:var(--er-p)" title="Delete"
                            onclick="DoctorMgmt.confirmDelete(${d.id},'${escHtml(d.name || "")}')">
                            &#x1F5D1;&#xFE0F;
                        </button>
                    </div>
                </div>
            </div>`;
        }).join("");
    }

    // ?? Geo filter cascade ????????????????????????????????????????????????????
    async function onCityFilter(cityId) {
        _cityId = cityId; _nigamId = ""; _zoneId = ""; _wardId = "";
        const nigamFlt = document.getElementById("dm-nigam-flt");
        const zoneFlt  = document.getElementById("dm-zone-flt");
        const wardFlt  = document.getElementById("dm-ward-flt");
        if (nigamFlt) { nigamFlt.innerHTML = '<option value="">&#x1F3DB;&#xFE0F; All Nigams</option>'; nigamFlt.style.display = "none"; }
        if (zoneFlt)  { zoneFlt.innerHTML  = '<option value="">&#x1F5FA;&#xFE0F; All Zones</option>';  zoneFlt.style.display  = "none"; }
        if (wardFlt)  { wardFlt.innerHTML  = '<option value="">&#x1F4CD; All Wards</option>';           wardFlt.style.display  = "none"; }
        if (cityId) {
            try {
                const nigams = await AFP.GET(`/api/geo/nigams?cityId=${cityId}`);
                if (nigams.length && nigamFlt) {
                    nigams.forEach(n => { const o = document.createElement("option"); o.value = n.id; o.textContent = n.name; nigamFlt.appendChild(o); });
                    nigamFlt.style.display = "";
                }
            } catch { }
        }
        await _loadDoctors();
    }

    async function onNigamFilter(nigamId) {
        _nigamId = nigamId; _zoneId = ""; _wardId = "";
        const zoneFlt = document.getElementById("dm-zone-flt");
        const wardFlt = document.getElementById("dm-ward-flt");
        if (zoneFlt) { zoneFlt.innerHTML = '<option value="">&#x1F5FA;&#xFE0F; All Zones</option>'; zoneFlt.style.display = "none"; }
        if (wardFlt) { wardFlt.innerHTML = '<option value="">&#x1F4CD; All Wards</option>';          wardFlt.style.display = "none"; }
        if (nigamId) {
            try {
                const zones = await AFP.GET(`/api/geo/zones?nigamId=${nigamId}`);
                if (zones.length && zoneFlt) {
                    zones.forEach(z => { const o = document.createElement("option"); o.value = z.id; o.textContent = z.name; zoneFlt.appendChild(o); });
                    zoneFlt.style.display = "";
                }
            } catch { }
        }
        await _loadDoctors();
    }

    async function onZoneFilter(zoneId) {
        _zoneId = zoneId; _wardId = "";
        const wardFlt = document.getElementById("dm-ward-flt");
        if (wardFlt) { wardFlt.innerHTML = '<option value="">&#x1F4CD; All Wards</option>'; wardFlt.style.display = "none"; }
        if (zoneId) {
            try {
                const wards = await AFP.GET(`/api/geo/wards?zoneId=${zoneId}`);
                if (wards.length && wardFlt) {
                    wards.forEach(w => { const o = document.createElement("option"); o.value = w.id; o.textContent = w.ward_number; wardFlt.appendChild(o); });
                    wardFlt.style.display = "";
                }
            } catch { }
        }
        await _loadDoctors();
    }

    async function onWardFilter(wardId) { _wardId = wardId; await _loadDoctors(); }

    function onSearch(val) { _search = val; _loadDoctors(); }

    // ?? Add / Edit modal ??????????????????????????????????????????????????????
    async function openModal(docId) {
        _editDoc = docId ? (_doctors.find(d => d.id === docId) ?? null) : null;
        const isEdit = !!_editDoc;

        let nigams = [], zones = [], wards = [];
        if (_editDoc?.city_id)  { try { nigams = await AFP.GET(`/api/geo/nigams?cityId=${_editDoc.city_id}`);   } catch { } }
        if (_editDoc?.nigam_id) { try { zones  = await AFP.GET(`/api/geo/zones?nigamId=${_editDoc.nigam_id}`);  } catch { } }
        if (_editDoc?.zone_id)  { try { wards  = await AFP.GET(`/api/geo/wards?zoneId=${_editDoc.zone_id}`);   } catch { } }

        const cityOpts  = _cities.map(c => `<option value="${c.id}"${_editDoc?.city_id  == c.id ? " selected" : ""}>${escHtml(c.name)}</option>`).join("");
        const nigamOpts = nigams.map(n  => `<option value="${n.id}"${_editDoc?.nigam_id == n.id ? " selected" : ""}>${escHtml(n.name)}</option>`).join("");
        const zoneOpts  = zones.map(z   => `<option value="${z.id}"${_editDoc?.zone_id  == z.id ? " selected" : ""}>${escHtml(z.name)}</option>`).join("");
        const wardOpts  = wards.map(w   => `<option value="${w.id}"${_editDoc?.ward_id  == w.id ? " selected" : ""}>${escHtml(w.ward_number)}</option>`).join("");

        const modal   = document.getElementById("dm-modal");
        const titleEl = document.getElementById("dm-modal-title");
        const bodyEl  = document.getElementById("dm-modal-body");
        const errEl   = document.getElementById("dm-modal-err");
        if (!modal) return;
        errEl.innerHTML = "";
        titleEl.textContent = isEdit ? `Edit \u2014 ${_editDoc.name || "Doctor"}` : "Add New Doctor / Vet";

        const is24hr = _editDoc?.is_24hr ?? false;

        bodyEl.innerHTML = `
            <div class="field">
                <label class="field-label">Doctor name *</label>
                <input id="dm-name" class="field-input"
                    value="${escHtml(_editDoc?.name || "")}" placeholder="Dr. Rajesh Verma" />
                <div id="dm-name-err" class="um-field-err"></div>
            </div>
            <div class="d-row">
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Mobile *</label>
                    <input id="dm-mobile" class="field-input" type="tel" maxlength="10"
                        value="${escHtml(_editDoc?.mobile || "")}" placeholder="10-digit mobile" />
                    <div id="dm-mobile-err" class="um-field-err"></div>
                </div>
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Qualification</label>
                    <input id="dm-qual" class="field-input"
                        value="${escHtml(_editDoc?.qualification || "")}" placeholder="BVSc, MVSc" />
                </div>
            </div>
            <div style="height:13px"></div>
            <div class="d-row">
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Specialization</label>
                    <input id="dm-spec" class="field-input"
                        value="${escHtml(_editDoc?.specialization || "")}" placeholder="Small animals" />
                </div>
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Clinic name</label>
                    <input id="dm-clinic" class="field-input"
                        value="${escHtml(_editDoc?.clinic_name || "")}" placeholder="Verma Pet Clinic" />
                </div>
            </div>
            <div style="height:13px"></div>
            <div class="field">
                <label class="field-label">Address *</label>
                <input id="dm-addr" class="field-input"
                    value="${escHtml(_editDoc?.address || "")}" placeholder="Full address" />
                <div id="dm-addr-err" class="um-field-err"></div>
            </div>
            <div class="field">
                <label class="field-label">Timings</label>
                <input id="dm-timings" class="field-input"
                    value="${escHtml(_editDoc?.timings || "")}" placeholder="9am-7pm (Mon-Sat)" />
            </div>
            <div class="alert-box alert-info" style="margin-bottom:10px">
                <span>&#x2139;&#xFE0F;</span>
                <p style="font-size:12px">Assign City &rarr; Nigam &rarr; Ward to set jurisdiction.</p>
            </div>
            <div class="field">
                <label class="field-label">City</label>
                <select id="dm-city" class="field-input" onchange="DoctorMgmt._onCityChange()">
                    <option value="">Select city&hellip;</option>
                    ${cityOpts}
                </select>
            </div>
            <div class="field" id="dm-nigam-field" style="${nigams.length ? "" : "display:none"}">
                <label class="field-label">Nigam</label>
                <select id="dm-nigam" class="field-input" onchange="DoctorMgmt._onNigamChange()">
                    <option value="">Select nigam&hellip;</option>
                    ${nigamOpts}
                </select>
            </div>
            <div class="field" id="dm-zone-field" style="${zones.length ? "" : "display:none"}">
                <label class="field-label">Zone</label>
                <select id="dm-zone" class="field-input" onchange="DoctorMgmt._onZoneChange()">
                    <option value="">Select zone&hellip;</option>
                    ${zoneOpts}
                </select>
            </div>
            <div class="field" id="dm-ward-field" style="${wards.length ? "" : "display:none"}">
                <label class="field-label">Ward</label>
                <select id="dm-ward" class="field-input">
                    <option value="">Select ward&hellip;</option>
                    ${wardOpts}
                </select>
            </div>
            <label class="checkbox-row" id="dm-24hr-row" style="margin-bottom:4px">
                <div class="checkbox${is24hr ? " checked" : ""}" id="dm-24hr-box">
                    ${is24hr ? `<span style="color:#fff;font-size:13px">&#x2713;</span>` : ""}
                </div>
                <span class="checkbox-lbl">24-hour clinic</span>
            </label>`;

        document.getElementById("dm-24hr-row").onclick = () => {
            const box = document.getElementById("dm-24hr-box");
            const was = box.classList.contains("checked");
            box.classList.toggle("checked", !was);
            box.innerHTML = !was ? `<span style="color:#fff;font-size:13px">&#x2713;</span>` : "";
        };

        modal.style.display = "flex";
    }

    // Modal geo cascade
    async function _onCityChange() {
        const cityId   = document.getElementById("dm-city")?.value;
        const nigamFld = document.getElementById("dm-nigam-field");
        const nigamSel = document.getElementById("dm-nigam");
        const wardFld  = document.getElementById("dm-ward-field");
        const wardSel  = document.getElementById("dm-ward");
        populatePicker(nigamSel, [], "Select nigam\u2026");
        populatePicker(wardSel,  [], "Select ward\u2026");
        if (nigamFld) nigamFld.style.display = "none";
        if (wardFld)  wardFld.style.display  = "none";
        if (!cityId) return;
        try {
            const nigams = await AFP.GET(`/api/geo/nigams?cityId=${cityId}`);
            if (nigams.length) {
                populatePicker(nigamSel, nigams.map(n => ({ label: n.name, value: n.id })), "Select nigam\u2026");
                if (nigamFld) nigamFld.style.display = "";
            }
        } catch { }
    }

    async function _onNigamChange() {
        const nigamId = document.getElementById("dm-nigam")?.value;
        const zoneFld = document.getElementById("dm-zone-field");
        const zoneSel = document.getElementById("dm-zone");
        const wardFld = document.getElementById("dm-ward-field");
        const wardSel = document.getElementById("dm-ward");
        populatePicker(zoneSel, [], "Select zone…");
        populatePicker(wardSel, [], "Select ward…");
        if (zoneFld) zoneFld.style.display = "none";
        if (wardFld) wardFld.style.display  = "none";
        if (!nigamId) return;
        try {
            const zones = await AFP.GET(`/api/geo/zones?nigamId=${nigamId}`);
            if (zones.length) {
                populatePicker(zoneSel, zones.map(z => ({ label: z.name, value: z.id })), "Select zone…");
                if (zoneFld) zoneFld.style.display = "";
            }
        } catch { }
    }

    async function _onZoneChange() {
        const zoneId  = document.getElementById("dm-zone")?.value;
        const wardFld = document.getElementById("dm-ward-field");
        const wardSel = document.getElementById("dm-ward");
        populatePicker(wardSel, [], "Select ward…");
        if (wardFld) wardFld.style.display = "none";
        if (!zoneId) return;
        try {
            const wards = await AFP.GET(`/api/geo/wards?zoneId=${zoneId}`);
            if (wards.length) {
                populatePicker(wardSel, wards.map(w => ({ label: w.ward_number, value: w.id })), "Select ward…");
                if (wardFld) wardFld.style.display = "";
            }
        } catch { }
    }

    // ?? Field-level error helpers ?????????????????????????????????????????????
    function _fe(id, msg) {
        const e = document.getElementById(`${id}-err`);
        const i = document.getElementById(id);
        if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; }
        if (i) { i.style.borderColor = msg ? "var(--er)" : ""; i.style.background = msg ? "var(--er-p)" : ""; }
        return !!msg;
    }
    function _fc(id) { _fe(id, ""); }

    // ?? Save ?????????????????????????????????????????????????????????????????
    async function saveEntry() {
        const errEl = document.getElementById("dm-modal-err");
        const btn   = document.getElementById("dm-modal-save-btn");
        errEl.innerHTML = "";

        const name    = document.getElementById("dm-name")?.value.trim()    || "";
        const mobile  = document.getElementById("dm-mobile")?.value.trim()  || "";
        const qual    = document.getElementById("dm-qual")?.value.trim()    || "";
        const spec    = document.getElementById("dm-spec")?.value.trim()    || "";
        const clinic  = document.getElementById("dm-clinic")?.value.trim()  || "";
        const addr    = document.getElementById("dm-addr")?.value.trim()    || "";
        const timings = document.getElementById("dm-timings")?.value.trim() || "";
        const cityId  = document.getElementById("dm-city")?.value  || null;
        const nigamId = document.getElementById("dm-nigam")?.value || null;
        const zoneId  = document.getElementById("dm-zone")?.value  || null;
        const wardId  = document.getElementById("dm-ward")?.value  || null;
        const is24hr  = document.getElementById("dm-24hr-box")?.classList.contains("checked") ?? false;

        ["dm-name", "dm-mobile", "dm-addr"].forEach(_fc);
        let hasErr = false;
        if (!name)                                    hasErr = _fe("dm-name",   "Doctor name is required.")        || hasErr;
        if (!addr)                                    hasErr = _fe("dm-addr",   "Address is required.")            || hasErr;
        if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) hasErr = _fe("dm-mobile", "Valid 10-digit mobile required.") || hasErr;
        if (hasErr) return;

        btn.classList.add("loading"); btn.disabled = true;
        try {
            const payload = {
                name, mobile,
                qualification:  qual,
                specialization: spec,
                clinicName:     clinic,
                address:        addr,
                timings, is24hr,
                ...(cityId  ? { cityId:  +cityId  } : {}),
                ...(nigamId ? { nigamId: +nigamId } : {}),
                ...(zoneId  ? { zoneId:  +zoneId  } : {}),
                ...(wardId  ? { wardId:  +wardId  } : {}),
            };
            if (_editDoc) {
                await _api("PUT", `/api/admin/doctors/${_editDoc.id}`, payload);
                AFP.tst(`${name} updated successfully!`);
            } else {
                await _api("POST", "/api/admin/doctors", payload);
                AFP.tst(`${name} added successfully!`);
            }
            closeModal();
            await _loadDoctors();
        } catch (ex) {
            errEl.innerHTML = alertBoxHTML("err", ex.message || "Failed to save. Please try again.");
        } finally { btn.classList.remove("loading"); btn.disabled = false; }
    }

    // ?? Delete ????????????????????????????????????????????????????????????????
    function confirmDelete(id, name) {
        const modal = document.getElementById("dm-confirm-modal");
        const msgEl = document.getElementById("dm-confirm-msg");
        if (!modal) return;
        msgEl.innerHTML = `Delete <strong>${escHtml(name)}</strong>? This action cannot be undone.`;
        modal._delId   = id;
        modal._delName = name;
        modal.style.display = "flex";
    }

    async function executeDelete() {
        const modal = document.getElementById("dm-confirm-modal");
        const btn   = document.getElementById("dm-confirm-del-btn");
        if (!modal?._delId) return;
        btn.classList.add("loading"); btn.disabled = true;
        try {
            await _api("DELETE", `/api/admin/doctors/${modal._delId}`);
            AFP.tst(`${modal._delName || "Doctor"} deleted.`);
            closeConfirmModal();
            await _loadDoctors();
        } catch (ex) {
            AFP.tst("Delete failed: " + ex.message);
            closeConfirmModal();
        } finally { btn.classList.remove("loading"); btn.disabled = false; }
    }

    // ?? Close modals ??????????????????????????????????????????????????????????
    function closeModal() {
        const m = document.getElementById("dm-modal");
        if (m) m.style.display = "none";
        _editDoc = null;
    }

    function closeConfirmModal() {
        const m = document.getElementById("dm-confirm-modal");
        if (m) { m.style.display = "none"; delete m._delId; delete m._delName; }
    }

    return {
        loadDoctorMgmt,
        onCityFilter, onNigamFilter, onZoneFilter, onWardFilter, onSearch,
        openModal, saveEntry, confirmDelete, executeDelete,
        closeModal, closeConfirmModal,
        _onCityChange, _onNigamChange, _onZoneChange,
    };
})();


// ?? SHOP MANAGEMENT ???????????????????????????????????????????????????????????
const ShopMgmt = (() => {

    // ?? State ????????????????????????????????????????????????????????????????
    let _search    = "";
    let _cityId    = "";
    let _nigamId   = "";
    let _zoneId    = "";
    let _wardId    = "";
    let _shops     = [];
    let _cities    = [];
    let _editShop  = null;
    let _container = null;

    // ?? Local proxy helper ????????????????????????????????????????????????????
    async function _api(method, path, body) {
        const token   = AFP.getToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res  = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || "Request failed");
        return data;
    }

    // ?? Entry point ???????????????????????????????????????????????????????????
    async function loadShopMgmt(container) {
        _container = container || document.getElementById("admin-body");
        _search = ""; _cityId = ""; _nigamId = ""; _zoneId = ""; _wardId = "";
        if (!_container) return;
        try { _cities = await AFP.GET("/api/geo/cities"); } catch { _cities = []; }
        _renderFrame();
        await _loadShops();
    }

    function _renderFrame() {
        const cityOpts = _cities.map(c =>
            `<option value="${c.id}">${escHtml(c.name)}</option>`
        ).join("");

        _container.innerHTML = `
            <div class="um-header">
                <div style="font-size:17px;font-weight:700">&#x1F6D2; Shop Management</div>
                <button class="btn btn-primary btn-small btn-w-auto"
                        onclick="ShopMgmt.openModal(null)"
                        style="padding:9px 14px">+ Add Shop</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
                <select id="sm-city-flt" class="field-input"
                        style="flex:1;min-width:110px;font-size:13px"
                        onchange="ShopMgmt.onCityFilter(this.value)">
                    <option value="">&#x1F3D9;&#xFE0F; All Cities</option>
                    ${cityOpts}
                </select>
                <select id="sm-nigam-flt" class="field-input"
                        style="flex:1;min-width:110px;font-size:13px;display:none"
                        onchange="ShopMgmt.onNigamFilter(this.value)">
                    <option value="">&#x1F3DB;&#xFE0F; All Nigams</option>
                </select>
                <select id="sm-zone-flt" class="field-input"
                        style="flex:1;min-width:110px;font-size:13px;display:none"
                        onchange="ShopMgmt.onZoneFilter(this.value)">
                    <option value="">&#x1F5FA;&#xFE0F; All Zones</option>
                </select>
                <select id="sm-ward-flt" class="field-input"
                        style="flex:1;min-width:110px;font-size:13px;display:none"
                        onchange="ShopMgmt.onWardFilter(this.value)">
                    <option value="">&#x1F4CD; All Wards</option>
                </select>
            </div>
            <div class="search-wrap" style="margin-bottom:13px">
                <span class="search-icon">&#x1F50D;</span>
                <input id="sm-search" class="field-input" style="padding-left:34px"
                    placeholder="Search by shop name, owner or mobile&hellip;"
                    oninput="ShopMgmt.onSearch(this.value)" />
            </div>
            <div id="sm-list"></div>`;
    }

    async function _loadShops() {
        const listEl = document.getElementById("sm-list");
        if (!listEl) return;
        renderLoading(listEl);
        try {
            const p = new URLSearchParams();
            if (_cityId)  p.set("cityId",  _cityId);
            if (_nigamId) p.set("nigamId", _nigamId);
            if (_zoneId)  p.set("zoneId",  _zoneId);
            if (_wardId)  p.set("wardId",  _wardId);
            if (_search)  p.set("q",       _search);
            _shops = await _api("GET", `/api/admin/shops?${p}`);
            _renderList(listEl);
        } catch (ex) {
            listEl.innerHTML = alertBoxHTML("err", "Failed to load shops: " + ex.message);
        }
    }

    function _renderList(listEl) {
        if (!_shops || _shops.length === 0) {
            renderEmpty(listEl, "&#x1F6D2;", "No pet food shops found");
            return;
        }
        listEl.innerHTML = _shops.map(s => {
            const geo = [s.ward_number, s.nigam_name, s.city_name].filter(Boolean).map(escHtml).join(" &middot; ");
            return `
            <div class="card um-card" id="sm-card-${s.id}">
                <div style="display:flex;align-items:center;gap:12px">
                    <div class="um-avatar" style="background:#F3E8FF">&#x1F6D2;</div>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:14px">${escHtml(s.name || "\u2014")}</div>
                        <div style="font-size:12px;color:var(--tx2);margin-top:2px">
                            ${s.owner_name ? `${escHtml(s.owner_name)} &middot; ` : ""}${escHtml(s.mobile || "")}
                        </div>
                        ${geo ? `<div style="font-size:11px;color:var(--tx3);margin-top:2px">&#x1F4CD; ${geo}</div>` : ""}
                        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">
                            ${s.speciality ? badgeHTML(s.speciality, "pn") : ""}
                            ${badgeHTML("Open", "ok")}
                        </div>
                        ${s.timings ? `<div style="font-size:11px;color:var(--tx3);margin-top:4px">&#x1F552; ${escHtml(s.timings)}</div>` : ""}
                    </div>
                    <div class="um-actions">
                        <button class="icon-btn" style="background:var(--bl-p)" title="Edit"
                            onclick="ShopMgmt.openModal(${s.id})">&#x270F;&#xFE0F;</button>
                        <button class="icon-btn" style="background:var(--er-p)" title="Delete"
                            onclick="ShopMgmt.confirmDelete(${s.id},'${escHtml(s.name || "")}')">
                            &#x1F5D1;&#xFE0F;
                        </button>
                    </div>
                </div>
            </div>`;
        }).join("");
    }

    // ?? Geo filter cascade ????????????????????????????????????????????????????
    async function onCityFilter(cityId) {
        _cityId = cityId; _nigamId = ""; _zoneId = ""; _wardId = "";
        const nigamFlt = document.getElementById("sm-nigam-flt");
        const zoneFlt  = document.getElementById("sm-zone-flt");
        const wardFlt  = document.getElementById("sm-ward-flt");
        if (nigamFlt) { nigamFlt.innerHTML = '<option value="">&#x1F3DB;&#xFE0F; All Nigams</option>'; nigamFlt.style.display = "none"; }
        if (zoneFlt)  { zoneFlt.innerHTML  = '<option value="">&#x1F5FA;&#xFE0F; All Zones</option>';  zoneFlt.style.display  = "none"; }
        if (wardFlt)  { wardFlt.innerHTML  = '<option value="">&#x1F4CD; All Wards</option>';           wardFlt.style.display  = "none"; }
        if (cityId) {
            try {
                const nigams = await AFP.GET(`/api/geo/nigams?cityId=${cityId}`);
                if (nigams.length && nigamFlt) {
                    nigams.forEach(n => { const o = document.createElement("option"); o.value = n.id; o.textContent = n.name; nigamFlt.appendChild(o); });
                    nigamFlt.style.display = "";
                }
            } catch { }
        }
        await _loadShops();
    }

    async function onNigamFilter(nigamId) {
        _nigamId = nigamId; _zoneId = ""; _wardId = "";
        const zoneFlt = document.getElementById("sm-zone-flt");
        const wardFlt = document.getElementById("sm-ward-flt");
        if (zoneFlt) { zoneFlt.innerHTML = '<option value="">&#x1F5FA;&#xFE0F; All Zones</option>'; zoneFlt.style.display = "none"; }
        if (wardFlt) { wardFlt.innerHTML = '<option value="">&#x1F4CD; All Wards</option>';          wardFlt.style.display = "none"; }
        if (nigamId) {
            try {
                const zones = await AFP.GET(`/api/geo/zones?nigamId=${nigamId}`);
                if (zones.length && zoneFlt) {
                    zones.forEach(z => { const o = document.createElement("option"); o.value = z.id; o.textContent = z.name; zoneFlt.appendChild(o); });
                    zoneFlt.style.display = "";
                }
            } catch { }
        }
        await _loadShops();
    }

    async function onZoneFilter(zoneId) {
        _zoneId = zoneId; _wardId = "";
        const wardFlt = document.getElementById("sm-ward-flt");
        if (wardFlt) { wardFlt.innerHTML = '<option value="">&#x1F4CD; All Wards</option>'; wardFlt.style.display = "none"; }
        if (zoneId) {
            try {
                const wards = await AFP.GET(`/api/geo/wards?zoneId=${zoneId}`);
                if (wards.length && wardFlt) {
                    wards.forEach(w => { const o = document.createElement("option"); o.value = w.id; o.textContent = w.ward_number; wardFlt.appendChild(o); });
                    wardFlt.style.display = "";
                }
            } catch { }
        }
        await _loadShops();
    }

    async function onWardFilter(wardId) { _wardId = wardId; await _loadShops(); }

    function onSearch(val) { _search = val; _loadShops(); }

    // ?? Add / Edit modal ??????????????????????????????????????????????????????
    async function openModal(shopId) {
        _editShop = shopId ? (_shops.find(s => s.id === shopId) ?? null) : null;
        const isEdit = !!_editShop;

        let nigams = [], zones = [], wards = [];
        if (_editShop?.city_id)  { try { nigams = await AFP.GET(`/api/geo/nigams?cityId=${_editShop.city_id}`);   } catch { } }
        if (_editShop?.nigam_id) { try { zones  = await AFP.GET(`/api/geo/zones?nigamId=${_editShop.nigam_id}`);  } catch { } }
        if (_editShop?.zone_id)  { try { wards  = await AFP.GET(`/api/geo/wards?zoneId=${_editShop.zone_id}`);   } catch { } }

        const cityOpts  = _cities.map(c => `<option value="${c.id}"${_editShop?.city_id  == c.id ? " selected" : ""}>${escHtml(c.name)}</option>`).join("");
        const nigamOpts = nigams.map(n  => `<option value="${n.id}"${_editShop?.nigam_id == n.id ? " selected" : ""}>${escHtml(n.name)}</option>`).join("");
        const zoneOpts  = zones.map(z   => `<option value="${z.id}"${_editShop?.zone_id  == z.id ? " selected" : ""}>${escHtml(z.name)}</option>`).join("");
        const wardOpts  = wards.map(w   => `<option value="${w.id}"${_editShop?.ward_id  == w.id ? " selected" : ""}>${escHtml(w.ward_number)}</option>`).join("");

        const modal   = document.getElementById("sm-modal");
        const titleEl = document.getElementById("sm-modal-title");
        const bodyEl  = document.getElementById("sm-modal-body");
        const errEl   = document.getElementById("sm-modal-err");
        if (!modal) return;
        errEl.innerHTML = "";
        titleEl.textContent = isEdit ? `Edit \u2014 ${_editShop.name || "Shop"}` : "Add New Pet Food Shop";

        bodyEl.innerHTML = `
            <div class="field">
                <label class="field-label">Shop name *</label>
                <input id="sm-name" class="field-input"
                    value="${escHtml(_editShop?.name || "")}" placeholder="Paws &amp; Claws" />
                <div id="sm-name-err" class="um-field-err"></div>
            </div>
            <div class="d-row">
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Mobile *</label>
                    <input id="sm-mobile" class="field-input" type="tel" maxlength="10"
                        value="${escHtml(_editShop?.mobile || "")}" placeholder="10-digit mobile" />
                    <div id="sm-mobile-err" class="um-field-err"></div>
                </div>
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Owner name</label>
                    <input id="sm-owner" class="field-input"
                        value="${escHtml(_editShop?.owner_name || "")}" placeholder="Amit Jain" />
                </div>
            </div>
            <div style="height:13px"></div>
            <div class="field">
                <label class="field-label">Address *</label>
                <input id="sm-addr" class="field-input"
                    value="${escHtml(_editShop?.address || "")}" placeholder="Full address" />
                <div id="sm-addr-err" class="um-field-err"></div>
            </div>
            <div class="d-row">
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Timings</label>
                    <input id="sm-timings" class="field-input"
                        value="${escHtml(_editShop?.timings || "")}" placeholder="9am-9pm" />
                </div>
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Speciality</label>
                    <input id="sm-spec" class="field-input"
                        value="${escHtml(_editShop?.speciality || "")}" placeholder="Dog food, accessories" />
                </div>
            </div>
            <div style="height:13px"></div>
            <div class="alert-box alert-info" style="margin-bottom:10px">
                <span>&#x2139;&#xFE0F;</span>
                <p style="font-size:12px">Assign City &rarr; Nigam &rarr; Ward to set jurisdiction.</p>
            </div>
            <div class="field">
                <label class="field-label">City</label>
                <select id="sm-city" class="field-input" onchange="ShopMgmt._onCityChange()">
                    <option value="">Select city&hellip;</option>
                    ${cityOpts}
                </select>
            </div>
            <div class="field" id="sm-nigam-field" style="${nigams.length ? "" : "display:none"}">
                <label class="field-label">Nigam</label>
                <select id="sm-nigam" class="field-input" onchange="ShopMgmt._onNigamChange()">
                    <option value="">Select nigam&hellip;</option>
                    ${nigamOpts}
                </select>
            </div>
            <div class="field" id="sm-zone-field" style="${zones.length ? "" : "display:none"}">
                <label class="field-label">Zone</label>
                <select id="sm-zone" class="field-input" onchange="ShopMgmt._onZoneChange()">
                    <option value="">Select zone&hellip;</option>
                    ${zoneOpts}
                </select>
            </div>
            <div class="field" id="sm-ward-field" style="${wards.length ? "" : "display:none"}">
                <label class="field-label">Ward</label>
                <select id="sm-ward" class="field-input">
                    <option value="">Select ward&hellip;</option>
                    ${wardOpts}
                </select>
            </div>`;

        modal.style.display = "flex";
    }

    // Modal geo cascade
    async function _onCityChange() {
        const cityId   = document.getElementById("sm-city")?.value;
        const nigamFld = document.getElementById("sm-nigam-field");
        const nigamSel = document.getElementById("sm-nigam");
        const wardFld  = document.getElementById("sm-ward-field");
        const wardSel  = document.getElementById("sm-ward");
        populatePicker(nigamSel, [], "Select nigam\u2026");
        populatePicker(wardSel,  [], "Select ward\u2026");
        if (nigamFld) nigamFld.style.display = "none";
        if (wardFld)  wardFld.style.display  = "none";
        if (!cityId) return;
        try {
            const nigams = await AFP.GET(`/api/geo/nigams?cityId=${cityId}`);
            if (nigams.length) {
                populatePicker(nigamSel, nigams.map(n => ({ label: n.name, value: n.id })), "Select nigam\u2026");
                if (nigamFld) nigamFld.style.display = "";
            }
        } catch { }
    }

    async function _onNigamChange() {
        const nigamId = document.getElementById("sm-nigam")?.value;
        const zoneFld = document.getElementById("sm-zone-field");
        const zoneSel = document.getElementById("sm-zone");
        const wardFld = document.getElementById("sm-ward-field");
        const wardSel = document.getElementById("sm-ward");
        populatePicker(zoneSel, [], "Select zone…");
        populatePicker(wardSel, [], "Select ward…");
        if (zoneFld) zoneFld.style.display = "none";
        if (wardFld) wardFld.style.display  = "none";
        if (!nigamId) return;
        try {
            const zones = await AFP.GET(`/api/geo/zones?nigamId=${nigamId}`);
            if (zones.length) {
                populatePicker(zoneSel, zones.map(z => ({ label: z.name, value: z.id })), "Select zone…");
                if (zoneFld) zoneFld.style.display = "";
            }
        } catch { }
    }

    async function _onZoneChange() {
        const zoneId  = document.getElementById("sm-zone")?.value;
        const wardFld = document.getElementById("sm-ward-field");
        const wardSel = document.getElementById("sm-ward");
        populatePicker(wardSel, [], "Select ward…");
        if (wardFld) wardFld.style.display = "none";
        if (!zoneId) return;
        try {
            const wards = await AFP.GET(`/api/geo/wards?zoneId=${zoneId}`);
            if (wards.length) {
                populatePicker(wardSel, wards.map(w => ({ label: w.ward_number, value: w.id })), "Select ward…");
                if (wardFld) wardFld.style.display = "";
            }
        } catch { }
    }

    // ?? Field-level error helpers ?????????????????????????????????????????????
    function _fe(id, msg) {
        const e = document.getElementById(`${id}-err`);
        const i = document.getElementById(id);
        if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; }
        if (i) { i.style.borderColor = msg ? "var(--er)" : ""; i.style.background = msg ? "var(--er-p)" : ""; }
        return !!msg;
    }
    function _fc(id) { _fe(id, ""); }

    // ?? Save ?????????????????????????????????????????????????????????????????
    async function saveEntry() {
        const errEl = document.getElementById("sm-modal-err");
        const btn   = document.getElementById("sm-modal-save-btn");
        errEl.innerHTML = "";

        const name    = document.getElementById("sm-name")?.value.trim()    || "";
        const mobile  = document.getElementById("sm-mobile")?.value.trim()  || "";
        const owner   = document.getElementById("sm-owner")?.value.trim()   || "";
        const addr    = document.getElementById("sm-addr")?.value.trim()    || "";
        const timings = document.getElementById("sm-timings")?.value.trim() || "";
        const spec    = document.getElementById("sm-spec")?.value.trim()    || "";
        const cityId  = document.getElementById("sm-city")?.value  || null;
        const nigamId = document.getElementById("sm-nigam")?.value || null;
        const zoneId  = document.getElementById("sm-zone")?.value  || null;
        const wardId  = document.getElementById("sm-ward")?.value  || null;

        ["sm-name", "sm-mobile", "sm-addr"].forEach(_fc);
        let hasErr = false;
        if (!name)                                    hasErr = _fe("sm-name",   "Shop name is required.")          || hasErr;
        if (!addr)                                    hasErr = _fe("sm-addr",   "Address is required.")            || hasErr;
        if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) hasErr = _fe("sm-mobile", "Valid 10-digit mobile required.") || hasErr;
        if (hasErr) return;

        btn.classList.add("loading"); btn.disabled = true;
        try {
            const payload = {
                name, mobile,
                ownerName:  owner,
                address:    addr,
                timings,
                speciality: spec,
                ...(cityId  ? { cityId:  +cityId  } : {}),
                ...(nigamId ? { nigamId: +nigamId } : {}),
                ...(zoneId  ? { zoneId:  +zoneId  } : {}),
                ...(wardId  ? { wardId:  +wardId  } : {}),
            };
            if (_editShop) {
                await _api("PUT", `/api/admin/shops/${_editShop.id}`, payload);
                AFP.tst(`${name} updated successfully!`);
            } else {
                await _api("POST", "/api/admin/shops", payload);
                AFP.tst(`${name} added successfully!`);
            }
            closeModal();
            await _loadShops();
        } catch (ex) {
            errEl.innerHTML = alertBoxHTML("err", ex.message || "Failed to save. Please try again.");
        } finally { btn.classList.remove("loading"); btn.disabled = false; }
    }

    // ?? Delete ????????????????????????????????????????????????????????????????
    function confirmDelete(id, name) {
        const modal = document.getElementById("sm-confirm-modal");
        const msgEl = document.getElementById("sm-confirm-msg");
        if (!modal) return;
        msgEl.innerHTML = `Delete <strong>${escHtml(name)}</strong>? This action cannot be undone.`;
        modal._delId   = id;
        modal._delName = name;
        modal.style.display = "flex";
    }

    async function executeDelete() {
        const modal = document.getElementById("sm-confirm-modal");
        const btn   = document.getElementById("sm-confirm-del-btn");
        if (!modal?._delId) return;
        btn.classList.add("loading"); btn.disabled = true;
        try {
            await _api("DELETE", `/api/admin/shops/${modal._delId}`);
            AFP.tst(`${modal._delName || "Shop"} deleted.`);
            closeConfirmModal();
            await _loadShops();
        } catch (ex) {
            AFP.tst("Delete failed: " + ex.message);
            closeConfirmModal();
        } finally { btn.classList.remove("loading"); btn.disabled = false; }
    }

    // ?? Close modals ??????????????????????????????????????????????????????????
    function closeModal() {
        const m = document.getElementById("sm-modal");
        if (m) m.style.display = "none";
        _editShop = null;
    }

    function closeConfirmModal() {
        const m = document.getElementById("sm-confirm-modal");
        if (m) { m.style.display = "none"; delete m._delId; delete m._delName; }
    }

    return {
        loadShopMgmt,
        onCityFilter, onNigamFilter, onZoneFilter, onWardFilter, onSearch,
        openModal, saveEntry, confirmDelete, executeDelete,
        closeModal, closeConfirmModal,
        _onCityChange, _onNigamChange, _onZoneChange,
    };
})();
