// ?? AFP AUDIT LOG VIEWER (super_admin only) ?????????????????????????????????
// Lists user activity (logins, register, user create/update/delete, etc.),
// supports search + date range + action filter + pagination, and lets
// super_admin delete individual rows, bulk delete by date range, or purge all.
// ????????????????????????????????????????????????????????????????????????????
const AuditLogs = (() => {
let _rows      = [];
let _total     = 0;
let _page      = 1;
let _pageSize  = 25;
let _q         = "";
let _action    = "";
let _from      = "";
let _to        = "";
let _container = null;
let _selected  = new Set();  // selected log ids across pages

    async function _api(method, path, body) {
        const token = AFP.getToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || "Request failed");
        return data;
    }

    async function loadLogs(container) {
        _container = container || document.getElementById("admin-body");
        if (!_container) return;
        _renderFrame();
        await _load();
    }

    function _renderFrame() {
        _container.innerHTML = `
            <div class="um-header">
                <div style="font-size:17px;font-weight:700">&#x1F4DC; Activity Logs</div>
                <button class="btn btn-danger btn-small btn-w-auto"
                        onclick="AuditLogs.purgeByDate()" style="padding:9px 14px">
                    &#x1F5D1;&#xFE0F; Delete by date
                </button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
                <input id="al-from" type="date" class="field-input"
                    style="flex:1;min-width:130px;font-size:13px"
                    onchange="AuditLogs.setDate('from', this.value)" />
                <input id="al-to" type="date" class="field-input"
                    style="flex:1;min-width:130px;font-size:13px"
                    onchange="AuditLogs.setDate('to', this.value)" />
                <select id="al-action" class="field-input"
                    style="flex:1;min-width:150px;font-size:13px"
                    onchange="AuditLogs.setAction(this.value)">
                    <option value="">All actions</option>
                    <option value="auth.login">Login</option>
                    <option value="auth.register">Register</option>
                    <option value="user.created">User created</option>
                    <option value="user.updated">User updated</option>
                    <option value="user.deleted">User deleted</option>
                    <option value="audit.log_deleted">Log deleted</option>
                    <option value="audit.logs_purged">Logs purged</option>
                </select>
            </div>
            <div class="search-wrap" style="margin-bottom:13px">
                <span class="search-icon">&#x1F50D;</span>
                <input id="al-q" class="field-input" style="padding-left:34px"
                    placeholder="Search by user name, mobile or details&hellip;"
                    oninput="AuditLogs.onSearch(this.value)" />
            </div>
            <div id="al-bulk-bar"
                 style="display:none;align-items:center;justify-content:space-between;gap:10px;
                        padding:10px 12px;background:var(--or-p);border:1px solid var(--or);
                        border-radius:9px;margin-bottom:10px;font-size:13px">
                <span id="al-bulk-count" style="font-weight:600">0 selected</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <button class="btn btn-danger btn-small btn-w-auto"
                        style="padding:6px 12px;font-size:12px" onclick="AuditLogs.deleteSelected()">
                        &#x1F5D1;&#xFE0F; Delete selected
                    </button>
                    <button class="btn btn-ghost btn-small btn-w-auto"
                        style="padding:6px 12px;font-size:12px" onclick="AuditLogs.clearSelection()">
                        Clear
                    </button>
                </div>
            </div>
            <label class="checkbox-row" style="margin:0 0 8px;cursor:pointer;background:var(--sf2);padding:8px 12px;border-radius:9px">
                <input type="checkbox" id="al-select-all"
                    style="width:16px;height:16px;margin-right:8px;accent-color:var(--or);cursor:pointer"
                    onchange="AuditLogs.toggleSelectAll(this.checked)" />
                <span class="checkbox-lbl" style="font-size:13px;font-weight:600">Select all on this page</span>
            </label>
            <div id="al-list"></div>
            <div id="al-pager"></div>`;
    }

    async function _load() {
        const listEl = document.getElementById("al-list");
        if (!listEl) return;
        renderLoading(listEl);
        try {
            const p = new URLSearchParams();
            if (_q)      p.set("q", _q);
            if (_action) p.set("action", _action);
            if (_from)   p.set("from", _from);
            if (_to)     p.set("to", _to);
            p.set("page", _page);
            p.set("pageSize", _pageSize);
            const res = await _api("GET", `/api/admin/audit-logs?${p}`);
            _rows  = res.rows  || [];
            _total = res.total || 0;
            _renderList(listEl);
            _renderPager();
            _updateBulkBar();
            _syncSelectAll();
        } catch (ex) {
            listEl.innerHTML = alertBoxHTML("err", "Failed to load logs: " + ex.message);
        }
    }

    function _renderList(listEl) {
        if (!_rows.length) {
            renderEmpty(listEl, "&#x1F4DC;", "No activity found for the selected filters");
            return;
        }
        const ACTION_CFG = {
            "auth.login":         { icon: "&#x1F511;", badge: "ok", label: "Login" },
            "auth.register":      { icon: "&#x1F4DD;", badge: "in", label: "Register" },
            "user.created":       { icon: "&#x2795;",  badge: "in", label: "User created" },
            "user.updated":       { icon: "&#x270F;&#xFE0F;", badge: "pn", label: "User updated" },
            "user.deleted":       { icon: "&#x1F5D1;&#xFE0F;", badge: "rj", label: "User deleted" },
            "audit.log_deleted":  { icon: "&#x1F9F9;", badge: "or", label: "Log deleted" },
            "audit.logs_purged":  { icon: "&#x1F525;", badge: "rj", label: "Logs purged" },
        };
        listEl.innerHTML = _rows.map(r => {
            const cfg = ACTION_CFG[r.action] || { icon: "&#x2699;&#xFE0F;", badge: "pn", label: r.action };
            const who = r.user_name
                ? `${escHtml(r.user_name)} <span style="color:var(--tx3);font-size:11px">(${escHtml((r.user_role||'').replace('_',' '))})</span>`
                : `<span style="color:var(--tx3)">Unknown user</span>`;
            const when = new Date(r.created_at).toLocaleString("en-IN");
            const checked = _selected.has(r.id) ? "checked" : "";
            return `
            <div class="card um-card" id="al-card-${r.id}">
                <div style="display:flex;align-items:flex-start;gap:12px">
                    <input type="checkbox" class="al-chk" data-id="${r.id}" ${checked}
                        onchange="AuditLogs.toggleSelect(${r.id}, this.checked)"
                        style="width:16px;height:16px;margin-top:6px;accent-color:var(--or);cursor:pointer;flex-shrink:0" />
                    <div class="um-avatar" style="background:var(--sf2);font-size:18px">${cfg.icon}</div>
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">
                            ${badgeHTML(cfg.label, cfg.badge)}
                            <div style="font-weight:600;font-size:13px">${who}</div>
                        </div>
                        ${r.user_mobile ? `<div style="font-size:11px;color:var(--tx2);margin-top:2px">&#x1F4F1; ${escHtml(r.user_mobile)}</div>` : ""}
                        ${r.details ? `<div style="font-size:12px;color:var(--tx);margin-top:4px">${escHtml(r.details)}</div>` : ""}
                        <div style="font-size:11px;color:var(--tx3);margin-top:4px">
                            &#x1F552; ${escHtml(when)}${r.ip_address ? ` &middot; IP ${escHtml(r.ip_address)}` : ""}
                        </div>
                    </div>
                    <button class="icon-btn" style="background:var(--er-p)" title="Delete log"
                        onclick="AuditLogs.deleteRow(${r.id})">&#x1F5D1;&#xFE0F;</button>
                </div>
            </div>`;
        }).join("");
    }

    function _renderPager() {
        const pager = document.getElementById("al-pager");
        if (!pager) return;
        const pages = Math.max(1, Math.ceil(_total / _pageSize));
        if (_total <= _pageSize) { pager.innerHTML = ""; return; }
        const start = (_page - 1) * _pageSize + 1;
        const end   = Math.min(_page * _pageSize, _total);
        pager.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;
                        padding:10px 12px;background:var(--sf2);border-radius:9px;font-size:12px;margin-top:10px">
                <div style="color:var(--tx2)">Showing <strong>${start}\u2013${end}</strong> of <strong>${_total}</strong></div>
                <div style="display:flex;gap:6px;align-items:center">
                    <button class="btn btn-ghost btn-small btn-w-auto" style="padding:5px 10px;font-size:12px"
                        ${_page <= 1 ? "disabled" : ""} onclick="AuditLogs.goToPage(${_page - 1})">&larr;</button>
                    <span style="padding:0 6px;color:var(--tx)"><strong>${_page}</strong> / ${pages}</span>
                    <button class="btn btn-ghost btn-small btn-w-auto" style="padding:5px 10px;font-size:12px"
                        ${_page >= pages ? "disabled" : ""} onclick="AuditLogs.goToPage(${_page + 1})">&rarr;</button>
                </div>
            </div>`;
    }

    function goToPage(n) {
        const pages = Math.max(1, Math.ceil(_total / _pageSize));
        _page = Math.min(Math.max(1, n), pages);
        _load();
    }

    let _sTimer = null;
    function onSearch(v) {
        _q = v; _page = 1;
        clearTimeout(_sTimer);
        _sTimer = setTimeout(_load, 300);
    }
    function setAction(v) { _action = v; _page = 1; _load(); }
    function setDate(k, v) { if (k === "from") _from = v; else _to = v; _page = 1; _load(); }

    async function deleteRow(id) {
        if (!confirm("Delete this log entry? This cannot be undone.")) return;
        try {
            await _api("DELETE", `/api/admin/audit-logs/${id}`);
            AFP.tst("Log entry deleted.");
            await _load();
        } catch (ex) { AFP.tst("Delete failed: " + ex.message); }
    }

    async function purgeByDate() {
        const from = document.getElementById("al-from")?.value || "";
        const to   = document.getElementById("al-to")?.value   || "";
        if (!from && !to) {
            if (!confirm("No date range selected. Delete ALL activity logs? This cannot be undone.")) return;
            try {
                const r = await _api("DELETE", "/api/admin/audit-logs", { all: true });
                AFP.tst(`Deleted ${r.deleted} log rows.`);
                _selected.clear();
                await _load();
            } catch (ex) { AFP.tst("Purge failed: " + ex.message); }
            return;
        }
        if (!confirm(`Delete all logs${from ? " from " + from : ""}${to ? " to " + to : ""}?`)) return;
        try {
            const r = await _api("DELETE", "/api/admin/audit-logs", { from: from || undefined, to: to || undefined });
            AFP.tst(`Deleted ${r.deleted} log rows.`);
            _selected.clear();
            await _load();
        } catch (ex) { AFP.tst("Purge failed: " + ex.message); }
    }

    // ?? Multi-select helpers ????????????????????????????????????????????????
    function toggleSelect(id, checked) {
        if (checked) _selected.add(id); else _selected.delete(id);
        _updateBulkBar();
        _syncSelectAll();
    }
    function toggleSelectAll(checked) {
        _rows.forEach(r => { if (checked) _selected.add(r.id); else _selected.delete(r.id); });
        document.querySelectorAll(".al-chk").forEach(cb => { cb.checked = !!checked; });
        _updateBulkBar();
    }
    function clearSelection() {
        _selected.clear();
        document.querySelectorAll(".al-chk").forEach(cb => { cb.checked = false; });
        _updateBulkBar();
        _syncSelectAll();
    }
    function _updateBulkBar() {
        const bar = document.getElementById("al-bulk-bar");
        const cnt = document.getElementById("al-bulk-count");
        if (!bar) return;
        bar.style.display = _selected.size > 0 ? "flex" : "none";
        if (cnt) cnt.textContent = `${_selected.size} selected`;
    }
    function _syncSelectAll() {
        const master = document.getElementById("al-select-all");
        if (!master) return;
        if (!_rows.length) { master.checked = false; return; }
        master.checked = _rows.every(r => _selected.has(r.id));
    }
    async function deleteSelected() {
        if (_selected.size === 0) return;
        const ids = Array.from(_selected);
        if (!confirm(`Delete ${ids.length} selected log entr${ids.length === 1 ? "y" : "ies"}? This cannot be undone.`)) return;
        try {
            const r = await _api("DELETE", "/api/admin/audit-logs", { ids });
            AFP.tst(`Deleted ${r.deleted} log rows.`);
            _selected.clear();
            await _load();
        } catch (ex) { AFP.tst("Delete failed: " + ex.message); }
    }

    return { loadLogs, onSearch, setAction, setDate, goToPage, deleteRow, purgeByDate,
             toggleSelect, toggleSelectAll, clearSelection, deleteSelected };
})();
