// ?? Admin Screens & State ?????????????????????????????????????????????????????
// Covers: admin panel, reports, billing, analytics, geo manager.
// Extracted from afp-screens.js for maintainability.
// All functions remain global so inline onclick= attributes in Index.cshtml work unchanged.

// ?? State (namespaced; legacy globals aliased for inline onclick= compatibility) ??
const AdminState = (() => {
    let _adminTab     = "overview";
    let _adminPending = [];
    let _adminAllPets = [];
    let _adminStats   = null;
    let _geoView      = "cities";
    let _selCity      = null;
    let _selNigam     = null;
    let _selZone      = null;
    let _geoCities    = [];
    let _geoNigams    = [];
    let _geoZones     = [];
    let _geoWards     = [];
    let _rcReportId   = null;
    let _rcEditId     = null;
    let _rcComments   = [];
    let _lastBilling  = null;

    return {
        get adminTab()      { return _adminTab; },      set adminTab(v)      { _adminTab = v; },
        get adminPending()  { return _adminPending; },  set adminPending(v)  { _adminPending = v; },
        get adminAllPets()  { return _adminAllPets; },  set adminAllPets(v)  { _adminAllPets = v; },
        get adminStats()    { return _adminStats; },    set adminStats(v)    { _adminStats = v; },
        get geoView()       { return _geoView; },       set geoView(v)       { _geoView = v; },
        get selCity()       { return _selCity; },       set selCity(v)       { _selCity = v; },
        get selNigam()      { return _selNigam; },      set selNigam(v)      { _selNigam = v; },
        get selZone()       { return _selZone; },       set selZone(v)       { _selZone = v; },
        get geoCities()     { return _geoCities; },     set geoCities(v)     { _geoCities = v; },
        get geoNigams()     { return _geoNigams; },     set geoNigams(v)     { _geoNigams = v; },
        get geoZones()      { return _geoZones; },      set geoZones(v)      { _geoZones = v; },
        get geoWards()      { return _geoWards; },      set geoWards(v)      { _geoWards = v; },
        get rcReportId()    { return _rcReportId; },    set rcReportId(v)    { _rcReportId = v; },
        get rcEditId()      { return _rcEditId; },      set rcEditId(v)      { _rcEditId = v; },
        get rcComments()    { return _rcComments; },    set rcComments(v)    { _rcComments = v; },
        get lastBilling()   { return _lastBilling; },   set lastBilling(v)   { _lastBilling = v; },
        resetAdmin() {
            _adminTab = "overview"; _adminPending = []; _adminAllPets = []; _adminStats = null;
            _geoView = "cities"; _selCity = null; _selNigam = null; _selZone = null;
            _geoCities = []; _geoNigams = []; _geoZones = []; _geoWards = [];
        },
    };
})();

// Legacy global aliases — keep inline onclick= handlers working without any HTML changes
Object.defineProperty(window, "_adminTab",      { get: () => AdminState.adminTab,     set: v => { AdminState.adminTab = v; } });
Object.defineProperty(window, "_adminPending",  { get: () => AdminState.adminPending, set: v => { AdminState.adminPending = v; } });
Object.defineProperty(window, "_adminAllPets",  { get: () => AdminState.adminAllPets, set: v => { AdminState.adminAllPets = v; } });
Object.defineProperty(window, "_adminStats",    { get: () => AdminState.adminStats,   set: v => { AdminState.adminStats = v; } });
Object.defineProperty(window, "_geoView",       { get: () => AdminState.geoView,      set: v => { AdminState.geoView = v; } });
Object.defineProperty(window, "_selCity",       { get: () => AdminState.selCity,      set: v => { AdminState.selCity = v; } });
Object.defineProperty(window, "_selNigam",      { get: () => AdminState.selNigam,     set: v => { AdminState.selNigam = v; } });
Object.defineProperty(window, "_selZone",       { get: () => AdminState.selZone,      set: v => { AdminState.selZone = v; } });
Object.defineProperty(window, "_geoCities",     { get: () => AdminState.geoCities,    set: v => { AdminState.geoCities = v; } });
Object.defineProperty(window, "_geoNigams",     { get: () => AdminState.geoNigams,    set: v => { AdminState.geoNigams = v; } });
Object.defineProperty(window, "_geoZones",      { get: () => AdminState.geoZones,     set: v => { AdminState.geoZones = v; } });
Object.defineProperty(window, "_geoWards",      { get: () => AdminState.geoWards,     set: v => { AdminState.geoWards = v; } });
Object.defineProperty(window, "_rcReportId",    { get: () => AdminState.rcReportId,   set: v => { AdminState.rcReportId = v; } });
Object.defineProperty(window, "_rcEditId",      { get: () => AdminState.rcEditId,     set: v => { AdminState.rcEditId = v; } });
Object.defineProperty(window, "_rcComments",    { get: () => AdminState.rcComments,   set: v => { AdminState.rcComments = v; } });
Object.defineProperty(window, "_lastBillingData",{ get: () => AdminState.lastBilling, set: v => { AdminState.lastBilling = v; } });

// ?? SCREEN: ADMIN ?????????????????????????????????????????????????????????????
async function loadAdmin() {
    const user = AFP.getUser();
    if (!user) { AFP.go("splash"); return; }
    AdminState.resetAdmin();
    document.getElementById("admin-role-badge").innerHTML =
        badgeHTML((user.role || "").replace("_", " "), "or");
    renderAdminTabBar(user);
    await renderAdminTab(AdminState.adminTab);
}

function renderAdminTabBar(user) {
    const isSA           = user?.role === "super_admin";
    const canManageUsers = ["super_admin","city_admin","nigam_admin","zone_admin","ward_admin"].includes(user?.role);
    const tabs = [
        { key: "overview",   label: "Overview" },
        { key: "pending",    label: `Pending (${AdminState.adminPending.length})` },
        { key: "pets",       label: "Pets" },
        ...(canManageUsers ? [{ key: "users",     label: "\ud83d\udc65 Users"     }] : []),
        ...(canManageUsers ? [{ key: "reports",   label: "\ud83d\udccb Reports"   }] : []),
        ...(canManageUsers ? [{ key: "billing",   label: "&#x1F4B3; Billing"     }] : []),
        { key: "cities",     label: "Cities" },
        ...(isSA ? [{ key: "doctors",   label: "+ Doctors"    }] : []),
        ...(isSA ? [{ key: "shops",     label: "+ Shops"      }] : []),
        ...(isSA ? [{ key: "analytics", label: "&#x1F4CA; Stats" }] : []),
    ];
    document.getElementById("admin-tabs").innerHTML = tabs.map(t =>
        `<button class="tab${AdminState.adminTab === t.key ? " active" : ""}"
             data-tab="${t.key}"
             onclick="adminSetTab('${t.key}')">${t.label}</button>`
    ).join("");
}

async function adminSetTab(tab) {
    AdminState.adminTab = tab;
    document.querySelectorAll("#admin-tabs .tab").forEach(t =>
        t.classList.toggle("active", t.dataset.tab === tab));
    await renderAdminTab(tab);
}

async function renderAdminTab(tab) {
    const body = document.getElementById("admin-body");
    const user = AFP.getUser();

    if (tab === "overview") {
        try {
            if (!AdminState.adminStats) {
                const [s, p] = await Promise.all([
                    AFP.GET("/api/admin/stats"),
                    AFP.GET("/api/pets/pending"),
                ]);
                AdminState.adminStats   = s;
                AdminState.adminPending = p;
                renderAdminTabBar(user);
            }
            const s = AdminState.adminStats;
            const geoLabel = user?.role === "super_admin"
                ? `&#x2B50; Super Admin`
                : user?.role === "city_admin"
                ? `&#x1F3D9;&#xFE0F; ${escHtml(user?.city_name || "")} &mdash; City Admin`
                : user?.role === "nigam_admin"
                ? `&#x1F3DB;&#xFE0F; ${escHtml(user?.nigam_name || "")} &mdash; Nigam Admin`
                : user?.role === "zone_admin"
                ? `&#x1F5FA;&#xFE0F; ${escHtml(user?.zone_name || "")} &mdash; ${escHtml(user?.nigam_name || "")}`
                : `&#x1F3DB;&#xFE0F; ${escHtml(user?.ward_number || "")} &mdash; ${escHtml(user?.nigam_name || "")}`;
            const panelLabel = user?.role === "super_admin" ? "System Overview"
                : user?.role === "city_admin"  ? "City dashboard"
                : user?.role === "nigam_admin" ? "Nigam dashboard"
                : user?.role === "zone_admin"  ? "Zone dashboard" : "Ward dashboard";
            body.innerHTML = `
                <div style="margin-bottom:15px">
                    <div class="cpill"><span class="cpill-tx">${geoLabel}</span></div>
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
                ${alertBoxHTML("info", `${AdminState.adminPending.length} application${AdminState.adminPending.length !== 1 ? "s" : ""} pending review.`)}`;
        } catch (ex) {
            body.innerHTML = alertBoxHTML("err", "Failed to load stats: " + ex.message);
        }

    } else if (tab === "pending") {
        renderLoading(body);
        try {
            AdminState.adminPending = await AFP.GET("/api/pets/pending");
            renderAdminTabBar(user);
            if (AdminState.adminPending.length === 0) {
                renderEmpty(body, "&#x2705;", "All caught up! No pending applications.");
                return;
            }
            body.innerHTML = AdminState.adminPending.map(p => `
                <div class="card" style="margin-bottom:11px" id="pending-card-${p.id}">
                    <div style="display:flex;gap:11px;align-items:center;margin-bottom:11px">
                        <div style="width:44px;height:44px;background:var(--or-p);border-radius:11px;
                                    display:flex;align-items:center;justify-content:center;font-size:22px">
                            ${AFP.spIco(p.species)}
                        </div>
                        <div style="flex:1">
                            <div style="font-size:14px;font-weight:600">${escHtml(p.name)}</div>
                            <div style="font-size:12px;color:var(--tx2)">${escHtml(p.breed || "")} &middot; ${escHtml(p.owner_name || "")}</div>
                            <div style="font-size:11px;color:var(--tx3)">${AFP.fmt(p.created_at)}</div>
                        </div>
                        ${badgeHTML("Pending", "pn")}
                    </div>
                    <div style="background:var(--sf2);border-radius:8px;padding:9px;margin-bottom:11px;font-size:12px;color:var(--tx2)">
                        Species: ${escHtml(p.species)} &middot; Colour: ${escHtml(p.colour || "")} &middot; DOB: ${AFP.fmt(p.date_of_birth)}
                    </div>
                    <div class="d-row">
                        <button id="approve-btn-${p.id}" class="btn btn-success btn-small" onclick="adminApprove(${p.id})">&#x2705; Approve</button>
                        <button id="reject-btn-${p.id}"  class="btn btn-danger  btn-small" onclick="adminReject(${p.id})">&#x274C; Reject</button>
                    </div>
                </div>`).join("");
        } catch (ex) {
            body.innerHTML = alertBoxHTML("err", "Failed to load pending: " + ex.message);
        }

    } else if (tab === "pets") {
        renderLoading(body);
        try {
            AdminState.adminAllPets = await AFP.GET("/api/admin/pets");
            if (AdminState.adminAllPets.length === 0) { renderEmpty(body, "&#x1F43E;", "No pets found"); return; }
            body.innerHTML = AdminState.adminAllPets.map(p => petCardHTML(p, `openPet(${p.id})`)).join("");
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

    } else if (tab === "billing") {
        await renderAdminBilling(body);

    } else if (tab === "analytics") {
        if (user?.role !== "super_admin") { body.innerHTML = alertBoxHTML("warn", "Super admin access required."); return; }
        await renderAnalyticsDashboard(body);
    }
}

async function adminApprove(id) {
    const btn = document.getElementById(`approve-btn-${id}`);
    if (btn) btn.classList.add("loading");
    try {
        await AFP.PATCH(`/api/pets/${id}/approve`, { note: "" });
        AFP.tst("Pet approved!");
        AdminState.adminStats = null;
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
        AdminState.adminStats = null;
        await renderAdminTab("pending");
    } catch (ex) { AFP.tst("Failed: " + ex.message); }
    finally { if (btn) btn.classList.remove("loading"); }
}

// ?? Reports ???????????????????????????????????????????????????????????????????
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
        if (!Array.isArray(reports) || reports.length === 0) {
            const user = AFP.getUser();
            const emptyMsg = user?.role === "super_admin" ? "No reports submitted yet."
                : user?.role === "city_admin"  ? "No reports in your city yet."
                : user?.role === "nigam_admin" ? "No reports in your nigam yet."
                : user?.role === "zone_admin"  ? "No reports in your zone yet."
                : "No reports in your ward yet.";
            renderEmpty(body, "&#x1F4CB;", emptyMsg);
            return;
        }
        body._reports = reports;
        const open     = reports.filter(r => r.status === "open").length;
        const resolved = reports.filter(r => r.status !== "open").length;
        body.innerHTML = `
            <div class="chips" style="margin-bottom:13px">
                <button class="chip report-filter-chip active" data-flt="all"
                    onclick="filterReports(this,'all')">All (${reports.length})</button>
                <button class="chip report-filter-chip" data-flt="open"
                    onclick="filterReports(this,'open')">&#x1F7E1; Open (${open})</button>
                <button class="chip report-filter-chip" data-flt="resolved"
                    onclick="filterReports(this,'resolved')">&#x2705; Resolved (${resolved})</button>
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
        : filter === "open" ? reports.filter(r => r.status === "open")
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
                <div style="font-size:14px;font-weight:600">${REPORT_LABELS[r.report_type] || escHtml(r.report_type)}</div>
                ${badgeHTML(isOpen ? "Open" : "Resolved", isOpen ? "pn" : "ok")}
            </div>
            <div style="font-size:12px;color:var(--tx2);margin-bottom:4px">&#x1F4CD; ${escHtml(r.last_seen_address || "No address given")}</div>
            <div style="font-size:11px;color:var(--tx3);margin-bottom:${isOpen ? "10px" : "6px"}">
                Reporter: ${escHtml(r.reporter_name || "Anonymous")} &middot;
                Mobile: ${escHtml(r.reporter_mobile || "\u2014")} &middot; ${AFP.fmt(r.created_at)}
            </div>
            ${!isOpen && r.resolution_note ? `
            <div style="font-size:11px;color:var(--ok);margin-top:4px;padding:6px 10px;
                        background:var(--ok-p);border-radius:7px;margin-bottom:6px">
                &#x2705; ${escHtml(r.resolution_note)}
            </div>` : ""}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <button class="btn btn-outline btn-small btn-w-auto" style="padding:7px 12px;font-size:12px"
                    data-report-json="${escHtml(JSON.stringify(r))}"
                    onclick="openReportCommentsModal(${r.id}, this.dataset.reportJson)">
                    &#x1F4AC; Comments
                </button>
                ${isOpen ? `
                <input id="resolve-note-${r.id}" class="field-input"
                    style="flex:1;min-width:120px;font-size:12px;padding:7px 10px"
                    placeholder="Resolution note (optional)&hellip;" />
                <button id="resolve-btn-${r.id}" class="btn btn-success btn-small btn-w-auto"
                    style="padding:8px 14px;white-space:nowrap" onclick="resolveReport(${r.id})">
                    &#x2714;&#xFE0F; Resolve
                </button>` : ""}
            </div>
        </div>`;
    }).join("");
}

async function resolveReport(id) {
    const noteEl = document.getElementById(`resolve-note-${id}`);
    const btn    = document.getElementById(`resolve-btn-${id}`);
    const note   = noteEl?.value.trim() || "";
    if (btn) { btn.classList.add("loading"); btn.disabled = true; }
    try {
        await AFP.PATCH(`/api/reports/${id}/resolve`, { note });
        AFP.tst("Report marked as resolved!");
        const body = document.getElementById("admin-body");
        await renderAdminReports(body);
    } catch (ex) {
        AFP.tst("\u26A0\uFE0F Failed: " + ex.message);
        if (btn) { btn.classList.remove("loading"); btn.disabled = false; }
    }
}

// ?? Report Comments Modal ?????????????????????????????????????????????????????
async function openReportCommentsModal(reportId, reportJson) {
    AdminState.rcReportId = reportId;
    AdminState.rcEditId   = null;
    AdminState.rcComments = [];
    const modal     = document.getElementById("rc-modal");
    const summary   = document.getElementById("rc-report-summary");
    const input     = document.getElementById("rc-comment-input");
    const errEl     = document.getElementById("rc-comment-err");
    const lbl       = document.getElementById("rc-form-label");
    const cancelBtn = document.getElementById("rc-cancel-edit-btn");
    if (!modal) return;
    let report = {};
    try {
        const raw = reportJson;
        report = (typeof raw === "string" && raw.length > 0) ? JSON.parse(raw) : (raw || {});
    } catch { }
    const REPORT_LABELS = { stray:"Stray / Abandoned", lost:"Lost Pet", unlicensed:"Unlicensed Pet", cruelty:"Animal Cruelty" };
    summary.innerHTML = `
        <strong>${escHtml(REPORT_LABELS[report.report_type] || report.report_type || "")}</strong>
        &nbsp;&middot;&nbsp; ${escHtml(report.last_seen_address || "No address")}
        &nbsp;&middot;&nbsp; Reporter: ${escHtml(report.reporter_name || "Anonymous")}
        &nbsp;&middot;&nbsp; ${AFP.fmt(report.created_at)}`;
    input.value          = "";
    errEl.style.display  = "none";
    lbl.textContent      = "Add Comment";
    cancelBtn.style.display = "none";
    modal.style.display = "flex";
    await _rcLoadComments();
}

async function _rcLoadComments() {
    const listEl = document.getElementById("rc-comments-list");
    if (!listEl || !AdminState.rcReportId) return;
    renderLoading(listEl);
    try {
        const data = await AFP.GET(`/api/reports/${AdminState.rcReportId}/comments`);
        AdminState.rcComments = Array.isArray(data) ? data : [];
        _rcRenderComments();
    } catch (ex) {
        listEl.innerHTML = `<div style="color:var(--er);font-size:12px;padding:8px">Failed to load comments: ${escHtml(ex.message)}</div>`;
    }
}

function _rcRenderComments() {
    const listEl = document.getElementById("rc-comments-list");
    const user   = AFP.getUser();
    if (!listEl) return;
    if (AdminState.rcComments.length === 0) {
        listEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--tx3);font-size:12px">No comments yet. Be the first to add one.</div>`;
        return;
    }
    listEl.innerHTML = AdminState.rcComments.map(c => {
        const isMine    = (c.admin_name === user?.name) || false;
        const isEditing = AdminState.rcEditId === c.id;
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
                    title="Edit comment" onclick="rcStartEdit(${c.id})">&#x270F;&#xFE0F;</button>` : ""}
            </div>
            <div style="font-size:10px;color:var(--tx3);margin-top:5px">
                ${escHtml(c.admin_name || "")}
                ${c.admin_role ? `&middot; ${escHtml(c.admin_role.replace("_"," "))}` : ""}
                &middot; ${AFP.fmt(c.created_at)}
                ${c.updated_at !== c.created_at ? " (edited)" : ""}
            </div>
        </div>`;
    }).join("");
    listEl.scrollTop = listEl.scrollHeight;
}

function rcStartEdit(commentId) {
    const c = AdminState.rcComments.find(x => x.id === commentId);
    if (!c) return;
    AdminState.rcEditId = commentId;
    const input     = document.getElementById("rc-comment-input");
    const lbl       = document.getElementById("rc-form-label");
    const cancelBtn = document.getElementById("rc-cancel-edit-btn");
    const errEl     = document.getElementById("rc-comment-err");
    if (input)     { input.value = c.comment; input.focus(); }
    if (lbl)       lbl.textContent = "Edit Comment";
    if (cancelBtn) cancelBtn.style.display = "";
    if (errEl)     { errEl.textContent = ""; errEl.style.display = "none"; }
    _rcRenderComments();
}

function rcCancelEdit() {
    AdminState.rcEditId = null;
    const input     = document.getElementById("rc-comment-input");
    const lbl       = document.getElementById("rc-form-label");
    const cancelBtn = document.getElementById("rc-cancel-edit-btn");
    const errEl     = document.getElementById("rc-comment-err");
    if (input)     input.value = "";
    if (lbl)       lbl.textContent = "Add Comment";
    if (cancelBtn) cancelBtn.style.display = "none";
    if (errEl)     { errEl.textContent = ""; errEl.style.display = "none"; }
    _rcRenderComments();
}

async function rcSaveComment() {
    const input   = document.getElementById("rc-comment-input");
    const errEl   = document.getElementById("rc-comment-err");
    const btn     = document.getElementById("rc-save-btn");
    const comment = input?.value.trim() || "";
    if (!comment) {
        if (errEl) { errEl.textContent = "Comment cannot be empty."; errEl.style.display = "block"; }
        input?.focus(); return;
    }
    if (errEl) { errEl.textContent = ""; errEl.style.display = "none"; }
    if (btn) { btn.classList.add("loading"); btn.disabled = true; }
    try {
        if (AdminState.rcEditId) {
            await AFP.PUT(`/api/reports/${AdminState.rcReportId}/comments/${AdminState.rcEditId}`, { comment });
            AFP.tst("Comment updated!");
            rcCancelEdit();
        } else {
            await AFP.POST(`/api/reports/${AdminState.rcReportId}/comments`, { comment });
            AFP.tst("Comment added!");
            if (input) input.value = "";
        }
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
    AdminState.rcReportId = null;
    AdminState.rcEditId   = null;
    AdminState.rcComments = [];
}

// ?? Billing ???????????????????????????????????????????????????????????????????
async function renderAdminBilling(body) {
    renderLoading(body);
    const user = AFP.getUser();
    const now  = new Date();
    const y    = now.getFullYear();
    const m    = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    const fromD = `${y}-${m}-01`;
    const toD   = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
    const role  = user?.role;
    const groupByOptions = (role === "super_admin" || role === "city_admin")
        ? [["ward","By Ward"],["zone","By Zone"],["nigam","By Nigam"],["city","By City"]]
        : role === "nigam_admin" ? [["ward","By Ward"],["zone","By Zone"]]
        : [["ward","By Ward"]];
    body.innerHTML = `
        <div style="font-size:17px;font-weight:700;margin-bottom:13px">&#x1F4B3; Billing &amp; Revenue Report</div>
        <div class="card" style="margin-bottom:14px">
            <div class="d-row" style="flex-wrap:wrap;gap:10px">
                <div class="field" style="margin-bottom:0;flex:1;min-width:120px">
                    <label class="field-label">From</label>
                    <input id="billing-from" type="date" class="field-input" value="${fromD}">
                </div>
                <div class="field" style="margin-bottom:0;flex:1;min-width:120px">
                    <label class="field-label">To</label>
                    <input id="billing-to" type="date" class="field-input" value="${toD}">
                </div>
                <div class="field" style="margin-bottom:0;flex:1;min-width:120px">
                    <label class="field-label">Group by</label>
                    <select id="billing-groupby" class="field-input">
                        ${groupByOptions.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
                    </select>
                </div>
            </div>
            <div class="d-row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
                <button class="btn btn-primary btn-small btn-w-auto" style="padding:9px 16px"
                    onclick="loadBillingReport()">&#x1F50D; Generate</button>
                <button class="btn btn-ghost btn-small btn-w-auto" style="padding:9px 14px"
                    onclick="billingSetQuick('month')">This Month</button>
                <button class="btn btn-ghost btn-small btn-w-auto" style="padding:9px 14px"
                    onclick="billingSetQuick('quarter')">This Quarter</button>
                <button class="btn btn-ghost btn-small btn-w-auto" style="padding:9px 14px"
                    onclick="billingSetQuick('year')">This Year</button>
            </div>
        </div>
        <div id="billing-result"></div>`;
    await loadBillingReport();
}

function billingSetQuick(period) {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    let from, to;
    if (period === "month")   { from = new Date(y, m, 1);               to = new Date(y, m + 1, 0); }
    else if (period === "quarter") { const qs = Math.floor(m/3)*3; from = new Date(y, qs, 1); to = new Date(y, qs+3, 0); }
    else                      { from = new Date(y, 0, 1);               to = new Date(y, 11, 31); }
    const fmt = d => d.toISOString().split("T")[0];
    const fEl = document.getElementById("billing-from");
    const tEl = document.getElementById("billing-to");
    if (fEl) fEl.value = fmt(from);
    if (tEl) tEl.value = fmt(to);
    loadBillingReport();
}

async function loadBillingReport() {
    const resultEl = document.getElementById("billing-result");
    if (!resultEl) return;
    renderLoading(resultEl);
    const from    = document.getElementById("billing-from")?.value    || "";
    const to      = document.getElementById("billing-to")?.value      || "";
    const groupBy = document.getElementById("billing-groupby")?.value || "ward";
    try {
        const data = await AFP.GET(`/api/admin/billing?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&groupBy=${groupBy}`);
        AdminState.lastBilling = { data, from, to, groupBy };
        const { rows, summary } = data;
        if (!rows || rows.length === 0) { renderEmpty(resultEl, "&#x1F4B3;", "No registrations in this period."); return; }
        const fmtINR   = n => `\u20B9\u00A0${Number(n || 0).toLocaleString("en-IN")}`;
        const grpLabel = { ward:"Ward", zone:"Zone", nigam:"Nigam", city:"City" }[groupBy] || "Group";
        const showCity = groupBy !== "city";
        const rowsHTML = rows.map(r => `
            <tr style="border-bottom:1px solid var(--bd)">
                <td style="padding:8px 10px;font-weight:600">${escHtml(r.group_label || "\u2014")}</td>
                ${showCity ? `<td style="padding:8px 10px;font-size:11px;color:var(--tx2)">${escHtml(r.city_name || "")}</td>` : ""}
                <td style="padding:8px 10px;text-align:center">${r.total || 0}</td>
                <td style="padding:8px 10px;text-align:center;color:var(--ok);font-weight:600">${r.approved || 0}</td>
                <td style="padding:8px 10px;text-align:center;color:var(--wn)">${r.pending || 0}</td>
                <td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--or)">${fmtINR(r.estimated_revenue)}</td>
            </tr>`).join("");
        resultEl.innerHTML = `
            <div class="sgrid" style="margin-bottom:13px">
                <div class="scard" style="flex:1">
                    <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Total Pets</div>
                    <div style="font-size:24px;font-weight:700">${summary.total}</div>
                </div>
                <div class="scard" style="flex:1">
                    <div style="font-size:10px;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Approved</div>
                    <div style="font-size:24px;font-weight:700;color:var(--ok)">${summary.approved}</div>
                </div>
                <div class="scard" style="flex:1;background:var(--or-p);border:1.5px solid var(--or)">
                    <div style="font-size:10px;color:var(--or);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Est. Revenue</div>
                    <div style="font-size:20px;font-weight:700;color:var(--or)">${fmtINR(summary.revenue)}</div>
                </div>
            </div>
            <div style="overflow-x:auto;margin-bottom:12px;border:1px solid var(--bd);border-radius:10px">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    <thead><tr style="background:var(--sf2)">
                        <th style="text-align:left;padding:9px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--tx2)">${grpLabel}</th>
                        ${showCity ? `<th style="text-align:left;padding:9px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--tx2)">City</th>` : ""}
                        <th style="text-align:center;padding:9px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--tx2)">Total</th>
                        <th style="text-align:center;padding:9px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--tx2)">Approved</th>
                        <th style="text-align:center;padding:9px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--tx2)">Pending</th>
                        <th style="text-align:right;padding:9px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--tx2)">Revenue</th>
                    </tr></thead>
                    <tbody>${rowsHTML}</tbody>
                    <tfoot><tr style="background:var(--or-p);font-weight:700;border-top:2px solid var(--or)">
                        <td style="padding:9px 10px" colspan="${showCity ? 2 : 1}">TOTAL</td>
                        <td style="text-align:center;padding:9px 8px">${summary.total}</td>
                        <td style="text-align:center;padding:9px 8px;color:var(--ok)">${summary.approved}</td>
                        <td style="text-align:center;padding:9px 8px;color:var(--wn)">${summary.pending}</td>
                        <td style="text-align:right;padding:9px 10px;color:var(--or)">${fmtINR(summary.revenue)}</td>
                    </tr></tfoot>
                </table>
            </div>
            <button class="btn btn-outline" style="width:auto;padding:10px 20px"
                onclick="printBillingInvoice()">&#x1F5A8;&#xFE0F; Print / Export Invoice</button>`;
    } catch (ex) {
        resultEl.innerHTML = alertBoxHTML("err", "Failed to load billing data: " + ex.message);
    }
}

function printBillingInvoice() {
    if (!AdminState.lastBilling) { AFP.tst("No billing data to print."); return; }
    const { data, from, to, groupBy } = AdminState.lastBilling;
    const user     = AFP.getUser();
    const { rows = [], summary = {} } = data;
    const e        = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const fmtINR   = n => `\u20B9\u00A0${Number(n || 0).toLocaleString("en-IN")}`;
    const fmtDate  = d => d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : "\u2014";
    const issuedOn = new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"});
    const grpLabel = { ward:"Ward", zone:"Zone", nigam:"Nigam", city:"City" }[groupBy] || "Group";
    const showCity = groupBy !== "city";
    const invoiceNo= `AFP-BILL-${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}-${String(Date.now()).slice(-4)}`;
    const rowsHTML = rows.map(r => `
        <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #f0ebe0;font-weight:600">${e(r.group_label || "\u2014")}</td>
            ${showCity ? `<td style="padding:6px 10px;border-bottom:1px solid #f0ebe0;color:#666;font-size:11px">${e(r.city_name || "")}</td>` : ""}
            <td style="padding:6px 10px;border-bottom:1px solid #f0ebe0;text-align:center">${r.total || 0}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f0ebe0;text-align:center;color:#065F46;font-weight:600">${r.approved || 0}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f0ebe0;text-align:center;color:#92400E">${r.pending || 0}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #f0ebe0;text-align:right;font-weight:700;color:#E8670A">${fmtINR(r.estimated_revenue)}</td>
        </tr>`).join("");
    const win = window.open("","_blank","width=900,height=700,scrollbars=yes");
    if (!win) { AFP.tst("\u26A0\uFE0F Please allow pop-ups to print."); return; }
    win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Billing Report \u2013 ${e(from)} to ${e(to)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#f0ebe0;padding:20px}
.actions{display:flex;gap:10px;justify-content:center;margin-bottom:16px}
.bp{padding:10px 26px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;background:#E8670A;color:#fff;border:none}
.bg{padding:10px 26px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:transparent;color:#5A564F;border:2px solid #c5bdb0}
.inv{width:100%;max-width:800px;margin:0 auto;background:#fff;border:2px solid #D4AF37}
.hdr{background:linear-gradient(135deg,#1A1814,#3A3228);color:#fff;padding:22px 28px;display:flex;align-items:center;gap:18px}
.emblem{width:60px;height:60px;border-radius:50%;background:rgba(212,175,55,.15);border:2px solid rgba(212,175,55,.5);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0}
.hdr-mid{flex:1}.hdr-gov{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:2px}
.hdr-title{font-size:18px;font-weight:700;color:#F5D87A;margin-bottom:2px}.hdr-sub{font-size:11px;color:rgba(255,255,255,.6)}
.hdr-right{text-align:right;flex-shrink:0}.inv-lbl{font-size:9px;color:rgba(255,255,255,.4);letter-spacing:1px;font-family:monospace;margin-bottom:4px}
.inv-no{background:#E8670A;color:#fff;padding:4px 12px;border-radius:5px;font-size:11px;font-weight:700;font-family:monospace}
.band{background:#D4AF37;padding:8px 28px;display:flex;align-items:center;justify-content:center;gap:14px}
.band-title{font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1A1814}
.band-deco{font-size:9px;color:rgba(0,0,0,.35);letter-spacing:3px}
.body{padding:20px 28px}.meta{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}
.meta-box{background:#f7f3ec;border:1px solid #D4AF37;border-radius:7px;padding:10px 14px;min-width:130px;flex:1}
.meta-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#8B6914;font-weight:600;margin-bottom:3px}
.meta-val{font-size:13px;font-weight:700;color:#1A1814}
.summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.scard{flex:1;min-width:100px;background:linear-gradient(135deg,#FFF3E8,#fff);border:1.5px solid #D4AF37;border-radius:9px;padding:12px;text-align:center}
.scard-icon{font-size:20px;margin-bottom:4px}.scard-val{font-size:20px;font-weight:700;color:#1A1814}
.scard-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#8B6914;margin-top:2px}
.sec{font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#8B6914;border-bottom:1px solid #D4AF37;padding-bottom:5px;margin-bottom:11px}
table{width:100%;border-collapse:collapse;font-size:12px}thead tr{background:#f7f3ec}
th{text-align:left;padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#8B6914;font-weight:700;border-bottom:2px solid #D4AF37}
tfoot tr{background:#FFF3E8;border-top:2px solid #E8670A}tfoot td{font-weight:700;padding:9px 10px;color:#1A1814}
.note{margin-top:14px;padding:10px 14px;background:#f7f3ec;border-radius:7px;border:1px solid #D4AF37;font-size:10px;color:#666;line-height:16px}
.ftr{background:#1A1814;color:rgba(255,255,255,.4);padding:8px 28px;display:flex;justify-content:space-between;font-size:9px;letter-spacing:.3px}
@media print{body{background:#fff;padding:0}.actions{display:none!important}.inv{max-width:100%}@page{size:A4;margin:12mm}}</style>
</head><body>
<div class="actions">
  <button class="bp" onclick="window.print()">&#x1F5A8;&#xFE0F;&nbsp; Print / Save as PDF</button>
  <button class="bg" onclick="window.close()">&#x2715; Close</button>
</div>
<div class="inv">
  <div class="hdr">
    <div class="emblem">&#x1F3DB;&#xFE0F;</div>
    <div class="hdr-mid">
      <div class="hdr-gov">Government of India \u2014 Municipal Corporation</div>
      <div class="hdr-title">Pet Registration Billing Statement</div>
      <div class="hdr-sub">${e(user?.nigam_name || user?.city_name || "All For Pets \u2014 Municipal Portal")}</div>
    </div>
    <div class="hdr-right"><div class="inv-lbl">INVOICE NO.</div><div class="inv-no">${e(invoiceNo)}</div></div>
  </div>
  <div class="band"><span class="band-deco">&#x25C6; &#x25C6; &#x25C6;</span><span class="band-title">Revenue &amp; Registration Summary</span><span class="band-deco">&#x25C6; &#x25C6; &#x25C6;</span></div>
  <div class="body">
    <div class="meta">
      <div class="meta-box"><div class="meta-lbl">Period From</div><div class="meta-val">${e(fmtDate(from))}</div></div>
      <div class="meta-box"><div class="meta-lbl">Period To</div><div class="meta-val">${e(fmtDate(to))}</div></div>
      <div class="meta-box"><div class="meta-lbl">Grouped By</div><div class="meta-val">${e(grpLabel)}</div></div>
      <div class="meta-box"><div class="meta-lbl">Prepared By</div><div class="meta-val">${e(user?.name || "Admin")} \u2014 ${e((user?.role||"").replace("_"," "))}</div></div>
      <div class="meta-box"><div class="meta-lbl">Issued On</div><div class="meta-val">${e(issuedOn)}</div></div>
    </div>
    <div class="summary">
      <div class="scard"><div class="scard-icon">&#x1F43E;</div><div class="scard-val">${summary.total||0}</div><div class="scard-lbl">Total Pets</div></div>
      <div class="scard"><div class="scard-icon">&#x2705;</div><div class="scard-val">${summary.approved||0}</div><div class="scard-lbl">Approved</div></div>
      <div class="scard"><div class="scard-icon">&#x23F3;</div><div class="scard-val">${summary.pending||0}</div><div class="scard-lbl">Pending</div></div>
      <div class="scard" style="border-color:#E8670A">
        <div class="scard-icon">&#x1F4B0;</div>
        <div class="scard-val" style="color:#E8670A">${fmtINR(summary.revenue)}</div>
        <div class="scard-lbl" style="color:#E8670A">Est. Revenue</div>
      </div>
    </div>
    <div class="sec">Registration Breakdown by ${e(grpLabel)}</div>
    <table>
      <thead><tr>
        <th>${e(grpLabel)}</th>${showCity ? "<th>City</th>" : ""}
        <th style="text-align:center">Total</th><th style="text-align:center">Approved</th>
        <th style="text-align:center">Pending</th><th style="text-align:right">Est. Revenue</th>
      </tr></thead>
      <tbody>${rowsHTML}</tbody>
      <tfoot><tr>
        <td colspan="${showCity?2:1}">TOTAL</td>
        <td style="text-align:center">${summary.total||0}</td>
        <td style="text-align:center;color:#065F46">${summary.approved||0}</td>
        <td style="text-align:center;color:#92400E">${summary.pending||0}</td>
        <td style="text-align:right;color:#E8670A">${fmtINR(summary.revenue)}</td>
      </tr></tfoot>
    </table>
    <div class="note"><strong style="color:#8B6914">Note:</strong> Estimated revenue = Approved Pets \u00D7 Nigam Registration Fee. Renewal and transfer revenues are not included.</div>
  </div>
  <div class="ftr">
    <span>Issued: ${e(issuedOn)}</span><span>allforpets.nagarnigam.gov.in</span><span>Period: ${e(from)} to ${e(to)}</span>
  </div>
</div></body></html>`);
    win.document.close();
}

// ?? Geo Manager ???????????????????????????????????????????????????????????????
async function renderGeoManager(container) {
    AdminState.geoView = "cities"; AdminState.selCity = null; AdminState.selNigam = null; AdminState.selZone = null;
    await renderGeoView(container);
}

function geoBreadcrumb() {
    let html = `<div class="breadcrumb">
        <button class="${AdminState.geoView === "cities" ? "active" : ""}" onclick="geoGoCity()">Cities</button>`;
    if (AdminState.selCity) {
        html += `<span class="breadcrumb-sep">&#8250;</span>
            <button class="${AdminState.geoView === "nigams" ? "active" : ""}" onclick="geoGoNigam()">${escHtml(AdminState.selCity.name)}</button>`;
    }
    if (AdminState.selNigam) {
        html += `<span class="breadcrumb-sep">&#8250;</span>
            <button class="${AdminState.geoView === "zones" ? "active" : ""}" onclick="geoGoZone()">${escHtml(AdminState.selNigam.name)}</button>`;
    }
    if (AdminState.selZone) {
        html += `<span class="breadcrumb-sep">&#8250;</span>
            <span style="font-size:13px;font-weight:700">${escHtml(AdminState.selZone.name)}</span>`;
    }
    return html + `</div>`;
}

async function renderGeoView(container) {
    const body = container || document.getElementById("admin-body");
    renderLoading(body);

    if (AdminState.geoView === "cities") {
        try { AdminState.geoCities = (await AFP.GET("/api/geo/cities/all")) || []; } catch { AdminState.geoCities = []; }
        body.innerHTML = geoBreadcrumb() + `
            <button class="btn btn-primary btn-small" style="margin-bottom:14px" onclick="openGeoModal('addCity')">+ Add New City</button>
            ${AdminState.geoCities.length === 0
                ? `<div class="center"><div class="center-icon">&#x1F3D9;&#xFE0F;</div><div class="center-text">No cities yet</div></div>`
                : AdminState.geoCities.map(c => `
                    <div class="card" style="margin-bottom:10px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <div style="flex:1;cursor:pointer" onclick="geoOpenCity(${c.id})">
                                <div style="font-weight:600;font-size:14px">${escHtml(c.name)}</div>
                                <div style="font-size:12px;color:var(--tx2);margin-top:2px">${escHtml(c.state || "")}</div>
                                <div style="font-size:11px;color:var(--tx3);margin-top:3px">
                                    ${c.nigam_count||0} nigams &middot; ${c.zone_count||0} zones &middot;
                                    ${c.ward_count||0} wards &middot; ${c.pet_count||0} pets
                                </div>
                            </div>
                            ${badgeHTML(c.is_active ? "Active" : "Inactive", c.is_active ? "ok" : "rj")}
                            <button class="icon-btn" style="background:var(--bl-p)" onclick='openGeoModal("editCity",${c.id})'>&#x270F;&#xFE0F;</button>
                        </div>
                        <button style="background:none;border:none;margin-top:10px;font-size:12px;color:var(--or);font-weight:600;cursor:pointer;padding:0"
                            onclick="geoOpenCity(${c.id})">View nigams &#8594;</button>
                    </div>`).join("")}`;

    } else if (AdminState.geoView === "nigams" && AdminState.selCity) {
        try { AdminState.geoNigams = (await AFP.GET(`/api/geo/nigams/all?cityId=${AdminState.selCity.id}`)) || []; } catch { AdminState.geoNigams = []; }
        body.innerHTML = geoBreadcrumb() + `
            <div class="d-row" style="margin-bottom:14px">
                <button class="btn btn-ghost btn-small" onclick="geoGoCity()">&#8592; Back</button>
                <button class="btn btn-primary btn-small" onclick="openGeoModal('addNigam')">+ Add Nigam</button>
            </div>
            ${AdminState.geoNigams.length === 0
                ? `<div class="center"><div class="center-icon">&#x1F3DB;&#xFE0F;</div><div class="center-text">No nigams in ${escHtml(AdminState.selCity.name)}</div></div>`
                : AdminState.geoNigams.map(n => `
                    <div class="card" style="margin-bottom:10px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <div style="flex:1;cursor:pointer" onclick="geoOpenNigam(${n.id})">
                                <div style="font-weight:600;font-size:13px">${escHtml(n.name)}</div>
                                <div style="font-size:11px;color:var(--tx3);margin-top:3px">${n.zone_count||0} zones &middot; ${n.ward_count||0} wards</div>
                                <div style="font-size:11px;color:var(--tx2);margin-top:4px">
                                    &#x1F4B3; Reg: &#x20B9;${n.registration_fee??200} &middot;
                                    Renew: &#x20B9;${n.renewal_fee??150} &middot;
                                    Transfer: &#x20B9;${n.transfer_fee??100}
                                </div>
                            </div>
                            ${badgeHTML(n.is_active ? "Active" : "Inactive", n.is_active ? "ok" : "rj")}
                            <button class="icon-btn" style="background:var(--bl-p)" onclick='openGeoModal("editNigam",${n.id})'>&#x270F;&#xFE0F;</button>
                        </div>
                        <button style="background:none;border:none;margin-top:8px;font-size:12px;color:var(--or);font-weight:600;cursor:pointer;padding:0"
                            onclick="geoOpenNigam(${n.id})">View zones &#8594;</button>
                    </div>`).join("")}`;

    } else if (AdminState.geoView === "zones" && AdminState.selNigam) {
        try { AdminState.geoZones = (await AFP.GET(`/api/geo/zones/all?nigamId=${AdminState.selNigam.id}`)) || []; } catch { AdminState.geoZones = []; }
        body.innerHTML = geoBreadcrumb() + `
            <div class="d-row" style="margin-bottom:14px">
                <button class="btn btn-ghost btn-small" onclick="geoGoNigam()">&#8592; Back</button>
                <button class="btn btn-primary btn-small" onclick="openGeoModal('addZone')">+ Add Zone</button>
            </div>
            ${AdminState.geoZones.length === 0
                ? `<div class="center"><div class="center-icon">&#x1F5FA;&#xFE0F;</div><div class="center-text">No zones in ${escHtml(AdminState.selNigam.name)}</div></div>`
                : AdminState.geoZones.map(z => `
                    <div class="card" style="margin-bottom:10px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <div style="flex:1;cursor:pointer" onclick="geoOpenZone(${z.id})">
                                <div style="font-weight:600;font-size:13px">${escHtml(z.name)}</div>
                                <div style="font-size:11px;color:var(--tx3);margin-top:3px">${z.ward_count||0} wards &middot; ${z.pet_count||0} pets</div>
                            </div>
                            ${badgeHTML(z.is_active ? "Active" : "Inactive", z.is_active ? "ok" : "rj")}
                            <button class="icon-btn" style="background:var(--bl-p)" onclick='openGeoModal("editZone",${z.id})'>&#x270F;&#xFE0F;</button>
                        </div>
                        <button style="background:none;border:none;margin-top:8px;font-size:12px;color:var(--or);font-weight:600;cursor:pointer;padding:0"
                            onclick="geoOpenZone(${z.id})">View wards &#8594;</button>
                    </div>`).join("")}`;

    } else if (AdminState.geoView === "wards" && AdminState.selZone) {
        try { AdminState.geoWards = (await AFP.GET(`/api/geo/wards/all?zoneId=${AdminState.selZone.id}`)) || []; } catch { AdminState.geoWards = []; }
        body.innerHTML = geoBreadcrumb() + `
            <div class="d-row" style="margin-bottom:14px">
                <button class="btn btn-ghost btn-small" onclick="geoGoZone()">&#8592; Back</button>
                <button class="btn btn-primary btn-small" onclick="openGeoModal('addWard')">+ Add Ward</button>
            </div>
            ${AdminState.geoWards.length === 0
                ? `<div class="center"><div class="center-icon">&#x1F4CD;</div><div class="center-text">No wards in ${escHtml(AdminState.selZone.name)}</div></div>`
                : AdminState.geoWards.map(w => `
                    <div class="card" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
                        <div style="flex:1">
                            <div style="font-weight:600;font-size:13px">${escHtml(w.ward_number)}</div>
                            <div style="font-size:11px;color:var(--tx3);margin-top:2px">${w.pet_count||0} pets</div>
                        </div>
                        ${badgeHTML(w.is_active ? "Active" : "Inactive", w.is_active ? "ok" : "rj")}
                        <button class="icon-btn" style="background:var(--bl-p)" onclick='openGeoModal("editWard",${w.id})'>&#x270F;&#xFE0F;</button>
                    </div>`).join("")}`;
    }
}

async function geoOpenCity(id)  { AdminState.selCity  = AdminState.geoCities.find(c => c.id === id); AdminState.selNigam = null; AdminState.selZone = null; AdminState.geoView = "nigams"; await renderGeoView(); }
async function geoOpenNigam(id) { AdminState.selNigam = AdminState.geoNigams.find(n => n.id === id); AdminState.selZone = null;  AdminState.geoView = "zones";  await renderGeoView(); }
async function geoOpenZone(id)  { AdminState.selZone  = AdminState.geoZones.find(z => z.id === id);  AdminState.geoView = "wards"; await renderGeoView(); }
async function geoGoCity()  { AdminState.geoView = "cities"; AdminState.selCity = null; AdminState.selNigam = null; AdminState.selZone = null; await renderGeoView(); }
async function geoGoNigam() { AdminState.geoView = "nigams"; AdminState.selNigam = null; AdminState.selZone = null; await renderGeoView(); }
async function geoGoZone()  { AdminState.geoView = "zones";  AdminState.selZone = null; await renderGeoView(); }

function openGeoModal(action, id) {
    const modal    = document.getElementById("geo-modal");
    const titleEl  = document.getElementById("geomodal-title");
    const fieldsEl = document.getElementById("geomodal-fields");
    const errEl    = document.getElementById("geomodal-err");
    if (!modal) return;
    errEl.innerHTML = "";
    let title = "", fields = [], saveHandler;

    if (action === "addCity") {
        title = "Add New City";
        fields = [{ id:"gf-name", label:"City name *", ph:"e.g. Pune" }, { id:"gf-state", label:"State *", ph:"e.g. Maharashtra" }];
        saveHandler = async () => {
            const n = document.getElementById("gf-name").value.trim();
            const s = document.getElementById("gf-state").value.trim();
            if (!n || !s) throw new Error("City name and state are required.");
            await AFP.POST("/api/geo/cities", { name:n, state:s });
            AFP.tst("City added!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "editCity") {
        const c = AdminState.geoCities.find(x => x.id === id);
        title = "Edit City";
        fields = [{ id:"gf-name", label:"City name *", ph:"e.g. Pune", val:c?.name }, { id:"gf-state", label:"State *", ph:"e.g. Maharashtra", val:c?.state }];
        saveHandler = async () => {
            const n = document.getElementById("gf-name").value.trim();
            const s = document.getElementById("gf-state").value.trim();
            if (!n || !s) throw new Error("City name and state are required.");
            await AFP.PUT(`/api/geo/cities/${id}`, { name:n, state:s, is_active:true });
            AFP.tst("Updated!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "addNigam") {
        title = `Add Nigam \u2014 ${AdminState.selCity?.name}`;
        fields = [
            { id:"gf-name",    label:"Nigam name *",                 ph:"e.g. Pune Municipal Corp" },
            { id:"gf-reg-fee", label:"Registration fee (\u20B9) *",  ph:"200", val:"200" },
            { id:"gf-ren-fee", label:"Renewal fee (\u20B9) *",       ph:"150", val:"150" },
            { id:"gf-txn-fee", label:"Transfer fee (\u20B9) *",      ph:"100", val:"100" },
        ];
        saveHandler = async () => {
            const n=document.getElementById("gf-name").value.trim(), rf=parseFloat(document.getElementById("gf-reg-fee").value), rnf=parseFloat(document.getElementById("gf-ren-fee").value), tf=parseFloat(document.getElementById("gf-txn-fee").value);
            if (!n) throw new Error("Nigam name is required.");
            if (isNaN(rf)||rf<0) throw new Error("Enter a valid registration fee.");
            if (isNaN(rnf)||rnf<0) throw new Error("Enter a valid renewal fee.");
            if (isNaN(tf)||tf<0) throw new Error("Enter a valid transfer fee.");
            await AFP.POST("/api/geo/nigams", { name:n, cityId:AdminState.selCity?.id, registration_fee:rf, renewal_fee:rnf, transfer_fee:tf });
            AFP.tst("Nigam added!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "editNigam") {
        const n = AdminState.geoNigams.find(x => x.id === id);
        title = "Edit Nigam";
        fields = [
            { id:"gf-name",    label:"Nigam name *",                 ph:"Nigam name", val:n?.name },
            { id:"gf-reg-fee", label:"Registration fee (\u20B9) *",  ph:"200", val:n?.registration_fee??200 },
            { id:"gf-ren-fee", label:"Renewal fee (\u20B9) *",       ph:"150", val:n?.renewal_fee??150 },
            { id:"gf-txn-fee", label:"Transfer fee (\u20B9) *",      ph:"100", val:n?.transfer_fee??100 },
        ];
        saveHandler = async () => {
            const nm=document.getElementById("gf-name").value.trim(), rf=parseFloat(document.getElementById("gf-reg-fee").value), rnf=parseFloat(document.getElementById("gf-ren-fee").value), tf=parseFloat(document.getElementById("gf-txn-fee").value);
            if (!nm) throw new Error("Nigam name is required.");
            if (isNaN(rf)||rf<0) throw new Error("Enter a valid registration fee.");
            if (isNaN(rnf)||rnf<0) throw new Error("Enter a valid renewal fee.");
            if (isNaN(tf)||tf<0) throw new Error("Enter a valid transfer fee.");
            await AFP.PUT(`/api/geo/nigams/${id}`, { name:nm, is_active:true, registration_fee:rf, renewal_fee:rnf, transfer_fee:tf });
            AFP.tst("Updated!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "addZone") {
        title = `Add Zone \u2014 ${AdminState.selNigam?.name}`;
        fields = [{ id:"gf-zone", label:"Zone name *", ph:"e.g. North Zone" }];
        saveHandler = async () => {
            const z = document.getElementById("gf-zone").value.trim();
            if (!z) throw new Error("Zone name is required.");
            await AFP.POST("/api/geo/zones", { name:z, nigamId:AdminState.selNigam?.id });
            AFP.tst("Zone added!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "editZone") {
        const z = AdminState.geoZones.find(x => x.id === id);
        title = "Edit Zone";
        fields = [{ id:"gf-zone", label:"Zone name *", ph:"e.g. North Zone", val:z?.name }];
        saveHandler = async () => {
            const zn = document.getElementById("gf-zone").value.trim();
            if (!zn) throw new Error("Zone name is required.");
            await AFP.PUT(`/api/geo/zones/${id}`, { name:zn, is_active:true });
            AFP.tst("Updated!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "addWard") {
        title = `Add Ward \u2014 ${AdminState.selZone?.name}`;
        fields = [{ id:"gf-ward", label:"Ward number / name *", ph:"e.g. Ward 15" }];
        saveHandler = async () => {
            const w = document.getElementById("gf-ward").value.trim();
            if (!w) throw new Error("Ward number is required.");
            await AFP.POST("/api/geo/wards", { wardNumber:w, zoneId:AdminState.selZone?.id, nigamId:AdminState.selNigam?.id });
            AFP.tst("Ward added!"); closeGeoModal(); await renderGeoView();
        };
    } else if (action === "editWard") {
        const w = AdminState.geoWards.find(x => x.id === id);
        title = "Edit Ward";
        fields = [{ id:"gf-ward", label:"Ward number / name *", ph:"e.g. Ward 15", val:w?.ward_number }];
        saveHandler = async () => {
            const wn = document.getElementById("gf-ward").value.trim();
            if (!wn) throw new Error("Ward number is required.");
            await AFP.PUT(`/api/geo/wards/${id}`, { wardNumber:wn, is_active:true });
            AFP.tst("Updated!"); closeGeoModal(); await renderGeoView();
        };
    }

    titleEl.textContent = title;
    fieldsEl.innerHTML  = fields.map(f => `
        <div class="field">
            <label class="field-label">${escHtml(f.label)}</label>
            <input id="${f.id}" class="field-input" placeholder="${escHtml(f.ph||"")}" value="${escHtml(f.val||"")}">
        </div>`).join("");
    modal._saveHandler  = saveHandler;
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

// ?? Legacy doctor/shop form helpers (fallback; primary rendering via DoctorMgmt/ShopMgmt) ??
function renderAddDoctorForm(container) {
    container.innerHTML = `
        <div class="sec-title" style="margin-bottom:14px">Add New Vet / Doctor</div>
        <div id="adddoc-err"></div>
        <form id="adddoc-form" novalidate>
            <div class="field"><label class="field-label">Doctor name *</label><input id="ad-name" class="field-input" placeholder="Dr. Rajesh Verma"><div id="ad-name-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div></div>
            <div class="field"><label class="field-label">Qualification</label><input id="ad-qual" class="field-input" placeholder="BVSc, MVSc"></div>
            <div class="field"><label class="field-label">Specialization</label><input id="ad-spec" class="field-input" placeholder="Small animals"></div>
            <div class="field"><label class="field-label">Clinic name</label><input id="ad-clinic" class="field-input" placeholder="Verma Pet Clinic"></div>
            <div class="field"><label class="field-label">Address *</label><input id="ad-addr" class="field-input" placeholder="Full address"><div id="ad-addr-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div></div>
            <div class="field"><label class="field-label">Mobile *</label><input id="ad-mobile" class="field-input" placeholder="9800011111" type="tel" maxlength="10"><div id="ad-mobile-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div></div>
            <div class="field"><label class="field-label">Timings</label><input id="ad-timings" class="field-input" placeholder="9am-7pm (Mon-Sat)"></div>
            <label class="checkbox-row" id="ad-24hr-row"><div class="checkbox" id="ad-24hr-box"></div><span class="checkbox-lbl">24-hour clinic</span></label>
            <button id="adddoc-btn" type="submit" class="btn btn-primary">Add Doctor &#8594;</button>
        </form>`;
    let is24hr = false;
    document.getElementById("ad-24hr-row").addEventListener("click", () => {
        is24hr = !is24hr;
        const box = document.getElementById("ad-24hr-box");
        box.classList.toggle("checked", is24hr);
        box.innerHTML = is24hr ? `<span style="color:#fff;font-size:13px">&#x2713;</span>` : "";
    });
    function _fErr(id, msg) { const e=document.getElementById(`${id}-err`),i=document.getElementById(id); if(e){e.textContent=msg||"";e.style.display=msg?"block":"none";}if(i){i.style.borderColor=msg?"var(--er)":"";i.style.background=msg?"var(--er-p)":"";}  }
    document.getElementById("ad-name").addEventListener("blur",function(){_fErr("ad-name",this.value.trim()?"":"Doctor name is required.");});
    document.getElementById("ad-addr").addEventListener("blur",function(){_fErr("ad-addr",this.value.trim()?"":"Address is required.");});
    document.getElementById("ad-mobile").addEventListener("blur",function(){_fErr("ad-mobile",!this.value.trim()?"Mobile is required.":/^[6-9]\d{9}$/.test(this.value.trim())?"":"Enter a valid 10-digit mobile number.");});
    document.getElementById("adddoc-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        const user=AFP.getUser(), name=document.getElementById("ad-name").value.trim(), mobile=document.getElementById("ad-mobile").value.trim(), addr=document.getElementById("ad-addr").value.trim();
        let valid=true;
        if(!name){_fErr("ad-name","Doctor name is required.");valid=false;}
        if(!addr){_fErr("ad-addr","Address is required.");valid=false;}
        if(!mobile){_fErr("ad-mobile","Mobile is required.");valid=false;}
        else if(!/^[6-9]\d{9}$/.test(mobile)){_fErr("ad-mobile","Enter a valid 10-digit mobile number.");valid=false;}
        if(!valid)return;
        const btn=document.getElementById("adddoc-btn"); btn.classList.add("loading");
        try {
            await AFP.POST("/api/doctors",{name,qualification:document.getElementById("ad-qual").value,specialization:document.getElementById("ad-spec").value,clinicName:document.getElementById("ad-clinic").value,address:addr,mobile,timings:document.getElementById("ad-timings").value,is24hr,wardId:user.ward_id,nigamId:user.nigam_id,cityId:user.city_id});
            AFP.tst("Doctor added successfully!"); adminSetTab("overview");
        } catch(ex){document.getElementById("adddoc-err").innerHTML=alertBoxHTML("err",ex.message);}
        finally{btn.classList.remove("loading");}
    });
}

function renderAddShopForm(container) {
    container.innerHTML = `
        <div class="sec-title" style="margin-bottom:14px">Add New Pet Food Shop</div>
        <div id="addshop-err"></div>
        <form id="addshop-form" novalidate>
            <div class="field"><label class="field-label">Shop name *</label><input id="as-name" class="field-input" placeholder="Paws &amp; Claws"><div id="as-name-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div></div>
            <div class="field"><label class="field-label">Owner name</label><input id="as-owner" class="field-input" placeholder="Amit Jain"></div>
            <div class="field"><label class="field-label">Address *</label><input id="as-addr" class="field-input" placeholder="Full address"><div id="as-addr-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div></div>
            <div class="field"><label class="field-label">Mobile *</label><input id="as-mobile" class="field-input" placeholder="9911000001" type="tel" maxlength="10"><div id="as-mobile-err" style="color:var(--er);font-size:11px;font-weight:600;margin-top:3px;display:none"></div></div>
            <div class="field"><label class="field-label">Timings</label><input id="as-timings" class="field-input" placeholder="9am-9pm"></div>
            <div class="field"><label class="field-label">Speciality</label><input id="as-spec" class="field-input" placeholder="Dog food, cat food, accessories"></div>
            <button id="addshop-btn" type="submit" class="btn btn-primary">Add Shop &#8594;</button>
        </form>`;
    function _fErr(id,msg){const e=document.getElementById(`${id}-err`),i=document.getElementById(id);if(e){e.textContent=msg||"";e.style.display=msg?"block":"none";}if(i){i.style.borderColor=msg?"var(--er)":"";i.style.background=msg?"var(--er-p)":"";}}
    document.getElementById("as-name").addEventListener("blur",function(){_fErr("as-name",this.value.trim()?"":"Shop name is required.");});
    document.getElementById("as-addr").addEventListener("blur",function(){_fErr("as-addr",this.value.trim()?"":"Address is required.");});
    document.getElementById("as-mobile").addEventListener("blur",function(){_fErr("as-mobile",!this.value.trim()?"Mobile is required.":/^[6-9]\d{9}$/.test(this.value.trim())?"":"Enter a valid 10-digit mobile number.");});
    document.getElementById("addshop-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        const user=AFP.getUser(),name=document.getElementById("as-name").value.trim(),mobile=document.getElementById("as-mobile").value.trim(),addr=document.getElementById("as-addr").value.trim();
        let valid=true;
        if(!name){_fErr("as-name","Shop name is required.");valid=false;}
        if(!addr){_fErr("as-addr","Address is required.");valid=false;}
        if(!mobile){_fErr("as-mobile","Mobile is required.");valid=false;}
        else if(!/^[6-9]\d{9}$/.test(mobile)){_fErr("as-mobile","Enter a valid 10-digit mobile number.");valid=false;}
        if(!valid)return;
        const btn=document.getElementById("addshop-btn"); btn.classList.add("loading");
        try{
            await AFP.POST("/api/shops",{name,ownerName:document.getElementById("as-owner").value,address:addr,mobile,timings:document.getElementById("as-timings").value,speciality:document.getElementById("as-spec").value,wardId:user.ward_id,nigamId:user.nigam_id,cityId:user.city_id});
            AFP.tst("Shop added successfully!"); adminSetTab("overview");
        }catch(ex){document.getElementById("addshop-err").innerHTML=alertBoxHTML("err",ex.message);}
        finally{btn.classList.remove("loading");}
    });
}
