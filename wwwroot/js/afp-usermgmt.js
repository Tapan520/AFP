// ?? AFP USER MANAGEMENT MODULE ????????????????????????????????????????????????
// Handles full CRUD (Add / Update / Delete) of all user types.
//
// Role hierarchy & access matrix:
//   super_admin  ? manage: super_admin, city_admin, nigam_admin, ward_admin, citizen
//   city_admin   ? manage: nigam_admin, ward_admin, citizen  (within their city)
//   nigam_admin  ? manage: ward_admin, citizen               (within their nigam)
//   ward_admin   ? manage: citizen                           (within their ward)
// ?????????????????????????????????????????????????????????????????????????????

const UserMgmt = (() => {

    // ?? State ?????????????????????????????????????????????????????????????????
    let _tab       = "citizen";
    let _search    = "";
    let _users     = [];
    let _cities    = [];
    let _editUser  = null;     // null = add mode, object = edit mode
    let _container = null;

    // ?? Role display config ???????????????????????????????????????????????????
    const ROLE_CFG = {
        citizen:     { label: "Citizen",     badge: "ok", icon: "&#x1F464;" },
        ward_admin:  { label: "Ward Admin",  badge: "in", icon: "&#x1F3E2;" },
        zone_admin:  { label: "Zone Admin",  badge: "or", icon: "&#x1F5FA;&#xFE0F;" },
        nigam_admin: { label: "Nigam Admin", badge: "pn", icon: "&#x1F3DB;&#xFE0F;" },
        city_admin:  { label: "City Admin",  badge: "rj", icon: "&#x1F3D9;&#xFE0F;" },
        super_admin: { label: "Super Admin", badge: "rj", icon: "&#x2B50;" },
    };

    // Roles the current user is allowed to manage
    function _manageableRoles(role) {
        switch (role) {
            case "super_admin": return ["citizen","ward_admin","zone_admin","nigam_admin","city_admin","super_admin"];
            case "city_admin":  return ["citizen","ward_admin","zone_admin","nigam_admin"];
            case "nigam_admin": return ["citizen","ward_admin","zone_admin"];
            case "zone_admin":  return ["citizen","ward_admin"];
            case "ward_admin":  return ["citizen"];
            default:            return [];
        }
    }

    // ?? Local .NET API helper (bypasses Railway API_BASE) ?????????????????????
    // /api/admin/users is served by Pages/AdminUsers.cshtml.cs on this .NET server.
    async function _localApi(method, path, body) {
        const token = AFP.getToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res  = await fetch(path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || "Request failed");
        return data;
    }

    // ?? Main loader ???????????????????????????????????????????????????????????
    async function loadUserMgmt(container) {
        _container = container || document.getElementById("admin-body");
        const user = AFP.getUser();
        if (!_container || !user) return;

        const roles = _manageableRoles(user.role);
        if (roles.length === 0) {
            _container.innerHTML = alertBoxHTML("warn", "You do not have permission to manage users.");
            return;
        }
        if (!roles.includes(_tab)) _tab = roles[0];

        try { _cities = await AFP.GET("/api/geo/cities"); } catch { _cities = []; }

        _renderFrame(user, roles);
        await _loadUsers();
    }

    function _renderFrame(user, roles) {
        const tabsHTML = roles.map(r => {
            const cfg = ROLE_CFG[r] || { label: r, icon: "&#x1F464;" };
            return `<button class="tab${_tab === r ? " active" : ""}" data-utab="${r}"
                        onclick="UserMgmt.setTab('${r}')">
                        ${cfg.icon}&nbsp;${cfg.label}s
                    </button>`;
        }).join("");

        _container.innerHTML = `
            <div class="um-header">
                <div style="font-size:17px;font-weight:700">&#x1F465; User Management</div>
                <button class="btn btn-primary btn-small btn-w-auto"
                        onclick="UserMgmt.openUserModal(null)"
                        style="padding:9px 14px">+ Add User</button>
            </div>
            <div class="tabs um-tabs" id="um-tabs">${tabsHTML}</div>
            <div class="search-wrap" style="margin-bottom:13px">
                <span class="search-icon">&#x1F50D;</span>
                <input id="um-search" class="field-input" style="padding-left:34px"
                    placeholder="Search by name, mobile or email&hellip;"
                    oninput="UserMgmt.onSearch(this.value)" />
            </div>
            <div id="um-list"></div>`;
    }

    async function _loadUsers() {
        const listEl = document.getElementById("um-list");
        if (!listEl) return;
        renderLoading(listEl);
        const user = AFP.getUser();
        try {
            const p = new URLSearchParams({ role: _tab });
            if (user.city_id  && user.role !== "super_admin") p.set("cityId",  user.city_id);
            if (user.nigam_id && user.role !== "super_admin" && user.role !== "city_admin") p.set("nigamId", user.nigam_id);
            if (user.ward_id  && user.role === "ward_admin")  p.set("wardId",  user.ward_id);
            if (_search) p.set("q", _search);
            _users = await _localApi("GET", `/api/admin/users?${p}`);
            _renderList(listEl);
        } catch (ex) {
            listEl.innerHTML = alertBoxHTML("err", "Failed to load users: " + ex.message);
        }
    }

    function _renderList(listEl) {
        if (!_users || _users.length === 0) {
            const cfg = ROLE_CFG[_tab] || {};
            renderEmpty(listEl, cfg.icon || "&#x1F464;", `No ${cfg.label || ""}s found`);
            return;
        }
        const me = AFP.getUser();
        listEl.innerHTML = _users.map(u => _userCardHTML(u, me)).join("");
    }

    function _userCardHTML(u, me) {
        const cfg    = ROLE_CFG[u.role] || { label: u.role, badge: "pn", icon: "&#x1F464;" };
        const isSelf = u.id === me?.id;
        const geo    = [u.ward_number, u.nigam_name, u.city_name].filter(Boolean).map(escHtml).join(" &middot; ");
        return `
        <div class="card um-card" id="um-card-${u.id}">
            <div style="display:flex;align-items:center;gap:12px">
                <div class="um-avatar">${cfg.icon}</div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:600;font-size:14px">
                        ${escHtml(u.name || "\u2014")}
                        ${isSelf ? `<span class="um-self-tag">(you)</span>` : ""}
                    </div>
                    <div style="font-size:12px;color:var(--tx2);margin-top:2px">
                        ${escHtml(u.mobile || "")}${u.email ? ` &middot; ${escHtml(u.email)}` : ""}
                    </div>
                    ${geo ? `<div style="font-size:11px;color:var(--tx3);margin-top:2px">${geo}</div>` : ""}
                    <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">
                        ${badgeHTML(cfg.label, cfg.badge)}
                        ${u.is_active === false ? badgeHTML("Inactive", "rj") : ""}
                    </div>
                </div>
                <div class="um-actions">
                    <button class="icon-btn" style="background:var(--bl-p)" title="Edit user"
                        onclick="UserMgmt.openUserModal(${u.id})">&#x270F;&#xFE0F;</button>
                    ${!isSelf ? `
                    <button class="icon-btn" style="background:var(--er-p)" title="Delete user"
                        onclick="UserMgmt.confirmDelete(${u.id},'${escHtml(u.name || "")}')">
                        &#x1F5D1;&#xFE0F;
                    </button>` : ""}
                </div>
            </div>
        </div>`;
    }

    // ?? Tab / search ??????????????????????????????????????????????????????????
    function setTab(role) {
        _tab = role; _search = "";
        const s = document.getElementById("um-search");
        if (s) s.value = "";
        document.querySelectorAll("#um-tabs .tab").forEach(t =>
            t.classList.toggle("active", t.dataset.utab === role));
        _loadUsers();
    }

    function onSearch(val) { _search = val; _loadUsers(); }

    // ?? Add / Edit user modal ?????????????????????????????????????????????????
    async function openUserModal(userId) {
        _editUser = userId ? (_users.find(u => u.id === userId) ?? null) : null;
        const me    = AFP.getUser();
        const roles = _manageableRoles(me.role);
        const isEdit = !!_editUser;

        // Pre-load geo data if editing existing user
        let nigams = [], zones = [], wards = [];
        if (_editUser?.city_id) {
            try { nigams = await AFP.GET(`/api/geo/nigams?cityId=${_editUser.city_id}`); } catch { }
        }
        if (_editUser?.nigam_id) {
            try { zones  = await AFP.GET(`/api/geo/zones?nigamId=${_editUser.nigam_id}`); } catch { }
        }
        if (_editUser?.zone_id) {
            try { wards  = await AFP.GET(`/api/geo/wards?zoneId=${_editUser.zone_id}`); } catch { }
        }

        const roleOpts = roles.map(r => {
            const cfg = ROLE_CFG[r] || { label: r };
            const sel = (_editUser?.role || _tab) === r ? "selected" : "";
            return `<option value="${r}" ${sel}>${cfg.label}</option>`;
        }).join("");

        const cityOpts = _cities.map(c => {
            const sel = _editUser?.city_id == c.id ? "selected" : "";
            return `<option value="${c.id}" ${sel}>${escHtml(c.name)}</option>`;
        }).join("");

        const nigamOpts = nigams.map(n => {
            const sel = _editUser?.nigam_id == n.id ? "selected" : "";
            return `<option value="${n.id}" ${sel}>${escHtml(n.name)}</option>`;
        }).join("");

        const zoneOpts = zones.map(z => {
            const sel = _editUser?.zone_id == z.id ? "selected" : "";
            return `<option value="${z.id}" ${sel}>${escHtml(z.name)}</option>`;
        }).join("");

        const wardOpts = wards.map(w => {
            const sel = _editUser?.ward_id == w.id ? "selected" : "";
            return `<option value="${w.id}" ${sel}>${escHtml(w.ward_number)}</option>`;
        }).join("");

        const modal   = document.getElementById("um-modal");
        const titleEl = document.getElementById("um-modal-title");
        const bodyEl  = document.getElementById("um-modal-body");
        const errEl   = document.getElementById("um-modal-err");
        if (!modal) return;
        errEl.innerHTML = "";
        titleEl.textContent = isEdit
            ? `Edit - ${_editUser.name || "User"}`
            : "Add New User";

        const isActiveChecked = _editUser?.is_active !== false;

        bodyEl.innerHTML = `
            <div class="field">
                <label class="field-label">Full name *</label>
                <input id="um-name" class="field-input" value="${escHtml(_editUser?.name || "")}"
                    placeholder="Full name" />
                <div id="um-name-err" class="um-field-err"></div>
            </div>
            <div class="d-row">
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Mobile *</label>
                    <input id="um-mobile" class="field-input" type="tel" maxlength="10"
                        value="${escHtml(_editUser?.mobile || "")}" placeholder="10-digit mobile" />
                    <div id="um-mobile-err" class="um-field-err"></div>
                </div>
                <div class="field" style="margin-bottom:0">
                    <label class="field-label">Email</label>
                    <input id="um-email" class="field-input" type="email"
                        value="${escHtml(_editUser?.email || "")}" placeholder="email@example.com" />
                </div>
            </div>
            <div style="height:13px"></div>
            <div class="field">
                <label class="field-label">Address</label>
                <input id="um-address" class="field-input"
                    value="${escHtml(_editUser?.address || "")}" placeholder="House, Street, Area" />
            </div>
            <div class="field">
                <label class="field-label">Role *</label>
                <select id="um-role" class="field-input" onchange="UserMgmt._onRoleChange()">
                    <option value="">Select role&hellip;</option>
                    ${roleOpts}
                </select>
                <div id="um-role-err" class="um-field-err"></div>
            </div>

            <!-- Geo assignment (hidden for super_admin role) -->
            <div id="um-geo-fields"
                 style="${(_editUser?.role === "super_admin") ? "display:none" : ""}">
                <div class="alert-box alert-info" style="margin-bottom:10px">
                    <span>&#x2139;&#xFE0F;</span>
                    <p style="font-size:12px">Select city &rarr; nigam &rarr; zone &rarr; ward to assign the user&rsquo;s jurisdiction.</p>
                </div>
                <div class="field">
                    <label class="field-label">City</label>
                    <select id="um-city" class="field-input" onchange="UserMgmt._onCityChange()">
                        <option value="">Select city&hellip;</option>
                        ${cityOpts}
                    </select>
                </div>
                <div class="field" id="um-nigam-field" style="${nigams.length ? "" : "display:none"}">
                    <label class="field-label">Nigam</label>
                    <select id="um-nigam" class="field-input" onchange="UserMgmt._onNigamChange()">
                        <option value="">Select nigam&hellip;</option>
                        ${nigamOpts}
                    </select>
                </div>
                <div class="field" id="um-zone-field" style="${zones.length ? "" : "display:none"}">
                    <label class="field-label">Zone</label>
                    <select id="um-zone" class="field-input" onchange="UserMgmt._onZoneChange()">
                        <option value="">Select zone&hellip;</option>
                        ${zoneOpts}
                    </select>
                </div>
                <div class="field" id="um-ward-field" style="${wards.length ? "" : "display:none"}">
                    <label class="field-label">Ward</label>
                    <select id="um-ward" class="field-input">
                        <option value="">Select ward&hellip;</option>
                        ${wardOpts}
                    </select>
                </div>
            </div>

            <div class="field">
                <label class="field-label">${isEdit
                    ? `New password <span style="color:var(--tx3);font-weight:400;text-transform:none">(leave blank to keep current)</span>`
                    : "Password *"}</label>
                <input id="um-password" class="field-input" type="password"
                    placeholder="${isEdit ? "Leave blank to keep current" : "Min 6 characters"}"
                    autocomplete="new-password" />
                <div id="um-password-err" class="um-field-err"></div>
            </div>

            <label class="checkbox-row" id="um-active-row" style="margin-bottom:4px">
                <div class="checkbox${isActiveChecked ? " checked" : ""}" id="um-active-box">
                    ${isActiveChecked ? `<span style="color:#fff;font-size:13px">&#x2713;</span>` : ""}
                </div>
                <span class="checkbox-lbl">Account is active</span>
            </label>`;

        // Wire checkbox toggle
        document.getElementById("um-active-row").onclick = () => {
            const box = document.getElementById("um-active-box");
            const wasChecked = box.classList.contains("checked");
            box.classList.toggle("checked", !wasChecked);
            box.innerHTML = !wasChecked ? `<span style="color:#fff;font-size:13px">&#x2713;</span>` : "";
        };

        modal.style.display = "flex";
    }

    // Role change ? show/hide geo section
    function _onRoleChange() {
        const role   = document.getElementById("um-role")?.value;
        const geoDiv = document.getElementById("um-geo-fields");
        if (geoDiv) geoDiv.style.display = role === "super_admin" ? "none" : "";
    }

    // City change ? cascade nigam
    async function _onCityChange() {
        const cityId     = document.getElementById("um-city")?.value;
        const nigamField = document.getElementById("um-nigam-field");
        const nigamSel   = document.getElementById("um-nigam");
        const wardField  = document.getElementById("um-ward-field");
        const wardSel    = document.getElementById("um-ward");
        populatePicker(nigamSel, [], "Select nigam&hellip;");
        populatePicker(wardSel,  [], "Select ward&hellip;");
        if (nigamField) nigamField.style.display = "none";
        if (wardField)  wardField.style.display  = "none";
        if (!cityId) return;
        try {
            const nigams = await AFP.GET(`/api/geo/nigams?cityId=${cityId}`);
            if (nigams.length) {
                populatePicker(nigamSel, nigams.map(n => ({ label: n.name, value: n.id })), "Select nigam\u2026");
                if (nigamField) nigamField.style.display = "";
            }
        } catch { }
    }

    // Nigam change -> cascade zone
    async function _onNigamChange() {
        const nigamId   = document.getElementById("um-nigam")?.value;
        const zoneField = document.getElementById("um-zone-field");
        const zoneSel   = document.getElementById("um-zone");
        const wardField = document.getElementById("um-ward-field");
        const wardSel   = document.getElementById("um-ward");
        populatePicker(zoneSel, [], "Select zone…");
        populatePicker(wardSel, [], "Select ward…");
        if (zoneField) zoneField.style.display = "none";
        if (wardField) wardField.style.display  = "none";
        if (!nigamId) return;
        try {
            const zones = await AFP.GET(`/api/geo/zones?nigamId=${nigamId}`);
            if (zones.length) {
                populatePicker(zoneSel, zones.map(z => ({ label: z.name, value: z.id })), "Select zone…");
                if (zoneField) zoneField.style.display = "";
            }
        } catch { }
    }

    // Zone change -> cascade ward
    async function _onZoneChange() {
        const zoneId    = document.getElementById("um-zone")?.value;
        const wardField = document.getElementById("um-ward-field");
        const wardSel   = document.getElementById("um-ward");
        populatePicker(wardSel, [], "Select ward…");
        if (wardField) wardField.style.display = "none";
        if (!zoneId) return;
        try {
            const wards = await AFP.GET(`/api/geo/wards?zoneId=${zoneId}`);
            if (wards.length) {
                populatePicker(wardSel, wards.map(w => ({ label: w.ward_number, value: w.id })), "Select ward…");
                if (wardField) wardField.style.display = "";
            }
        } catch { }
    }

    // ?? Field-level error helper ??????????????????????????????????????????????
    function _fe(id, msg) {
        const e = document.getElementById(`${id}-err`);
        const i = document.getElementById(id);
        if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; }
        if (i) { i.style.borderColor = msg ? "var(--er)" : ""; i.style.background = msg ? "var(--er-p)" : ""; }
        return !!msg;
    }
    function _fc(id) { _fe(id, ""); }

    // ?? Save (add / update) ???????????????????????????????????????????????????
    async function saveUser() {
        const errEl = document.getElementById("um-modal-err");
        const btn   = document.getElementById("um-modal-save-btn");
        errEl.innerHTML = "";

        const name     = document.getElementById("um-name")?.value.trim()    || "";
        const mobile   = document.getElementById("um-mobile")?.value.trim()  || "";
        const email    = document.getElementById("um-email")?.value.trim()   || "";
        const address  = document.getElementById("um-address")?.value.trim() || "";
        const role     = document.getElementById("um-role")?.value            || "";
        const cityId   = document.getElementById("um-city")?.value    || null;
        const nigamId  = document.getElementById("um-nigam")?.value   || null;
        const zoneId   = document.getElementById("um-zone")?.value    || null;
        const wardId   = document.getElementById("um-ward")?.value    || null;
        const password = document.getElementById("um-password")?.value        || "";
        const isActive = document.getElementById("um-active-box")?.classList.contains("checked") ?? true;

        // Clear previous errors
        ["um-name","um-mobile","um-role","um-password"].forEach(_fc);

        // Validate
        let hasErr = false;
        if (!name)                                    hasErr = _fe("um-name",     "Full name is required.")        || hasErr;
        if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) hasErr = _fe("um-mobile",   "Valid 10-digit mobile required.") || hasErr;
        if (!role)                                    hasErr = _fe("um-role",     "Please select a role.")          || hasErr;
        if (!_editUser && !password)                  hasErr = _fe("um-password", "Password required for new users.") || hasErr;
        if (password && password.length < 6)          hasErr = _fe("um-password", "Password must be at least 6 characters.") || hasErr;
        if (hasErr) return;

        btn.classList.add("loading"); btn.disabled = true;
        try {
            const payload = {
                name, mobile, email, address, role, is_active: isActive,
                ...(cityId  ? { cityId:  +cityId  } : {}),
                ...(nigamId ? { nigamId: +nigamId } : {}),
                ...(zoneId  ? { zoneId:  +zoneId  } : {}),
                ...(wardId  ? { wardId:  +wardId  } : {}),
                ...(password ? { password } : {}),
            };
            if (_editUser) {
                await _localApi("PUT", `/api/admin/users/${_editUser.id}`, payload);
                AFP.tst(`${name} updated successfully!`);
            } else {
                await _localApi("POST", "/api/admin/users", payload);
                AFP.tst(`${name} added successfully!`);
            }
            closeUserModal();
            await _loadUsers();
        } catch (ex) {
            errEl.innerHTML = alertBoxHTML("err", ex.message || "Failed to save. Please try again.");
        } finally { btn.classList.remove("loading"); btn.disabled = false; }
    }

    // ?? Delete ????????????????????????????????????????????????????????????????
    function confirmDelete(userId, userName) {
        const modal = document.getElementById("um-confirm-modal");
        const msgEl = document.getElementById("um-confirm-msg");
        if (!modal) return;
        msgEl.innerHTML = `Delete <strong>${escHtml(userName)}</strong>? This action cannot be undone.`;
        modal._delId   = userId;
        modal._delName = userName;
        modal.style.display = "flex";
    }

    async function executeDelete() {
        const modal = document.getElementById("um-confirm-modal");
        const btn   = document.getElementById("um-confirm-del-btn");
        if (!modal?._delId) return;
        btn.classList.add("loading"); btn.disabled = true;
        try {
            await _localApi("DELETE", `/api/admin/users/${modal._delId}`);
            AFP.tst(`${modal._delName || "User"} deleted.`);
            closeConfirmModal();
            await _loadUsers();
        } catch (ex) {
            AFP.tst("Delete failed: " + ex.message);
            closeConfirmModal();
        } finally { btn.classList.remove("loading"); btn.disabled = false; }
    }

    // ?? Close modals ??????????????????????????????????????????????????????????
    function closeUserModal() {
        const m = document.getElementById("um-modal");
        if (m) m.style.display = "none";
        _editUser = null;
    }

    function closeConfirmModal() {
        const m = document.getElementById("um-confirm-modal");
        if (m) { m.style.display = "none"; delete m._delId; delete m._delName; }
    }

    return {
        loadUserMgmt, setTab, onSearch,
        openUserModal, saveUser,
        confirmDelete, executeDelete,
        closeUserModal, closeConfirmModal,
        _onRoleChange, _onCityChange, _onNigamChange, _onZoneChange,
    };
})();
