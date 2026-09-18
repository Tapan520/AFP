// ── AFP FEE MANAGEMENT MODULE ────────────────────────────────────────────────
// Per-nigam registration / renewal / transfer fee editor.
//
// Who can use this UI?
//   • super_admin  — lists ALL nigams grouped by city, can edit any fee
//   • nigam_admin  — sees ONLY their own nigam, can edit its fees
//
// Server-side auth is enforced by PUT /api/geo/nigams/:id in
// railway-backend/routes/geo.js — the UI simply mirrors that policy.
// Every save writes to nigam_fee_history for a full audit trail; the "History"
// button opens a modal that reads /api/geo/nigams/:id/fee-history.
// ─────────────────────────────────────────────────────────────────────────────

const FeeMgmt = (() => {
    // Bounds mirror the server-side validation in geo.js (_validateFee).
    const FEE_MIN = 0;
    const FEE_MAX = 10_000;

    let _container = null;
    let _nigams    = [];   // enriched with city_name for grouping
    let _cities    = [];

    async function loadFeeMgmt(container) {
        _container = container || document.getElementById("admin-body");
        const user = AFP.getUser();
        if (!_container || !user) return;

        renderLoading(_container);
        try {
            if (user.role === "super_admin") {
                // super_admin sees /api/geo/nigams/all which includes counts + fees
                const [nigams, cities] = await Promise.all([
                    AFP.GET("/api/geo/nigams/all"),
                    AFP.GET("/api/geo/cities"),
                ]);
                _cities = cities || [];
                const byCity = new Map(_cities.map(c => [c.id, c.name]));
                _nigams = (nigams || []).map(n => ({
                    ...n,
                    city_name: byCity.get(n.city_id) || "\u2014",
                }));
            } else {
                // nigam_admin sees only their own nigam
                if (!user.nigam_id) {
                    _container.innerHTML = alertBoxHTML("warn",
                        "Your account is not linked to a nigam. Contact a Super Admin.");
                    return;
                }
                const n = await AFP.GET(`/api/geo/nigams/${user.nigam_id}`);
                _nigams = [{ ...n, city_name: user.city_name || "" }];
            }
            _render();
        } catch (ex) {
            _container.innerHTML = alertBoxHTML("err", "Failed to load fees: " + ex.message);
        }
    }

    function _render() {
        const user = AFP.getUser();
        const isSA = user?.role === "super_admin";

        if (!_nigams.length) {
            renderEmpty(_container, "&#x1F4B0;", "No nigams available.");
            return;
        }

        // Group super_admin view by city; nigam_admin has a single card.
        const groups = new Map();
        for (const n of _nigams) {
            const key = n.city_name || "\u2014";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(n);
        }

        let html = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
                <div>
                    <div style="font-size:17px;font-weight:700">\u{1F4B0} Nigam Fees</div>
                    <div style="font-size:12px;color:var(--tx2);margin-top:2px">
                        Set the Registration, Renewal and Transfer fees that citizens see at payment time.
                    </div>
                </div>
            </div>
            <div class="alert-box alert-info" style="margin-bottom:14px">
                <span>\u2139\uFE0F</span>
                <p style="font-size:12px">
                    Fees are in <strong>\u20B9 INR</strong>. Allowed range: \u20B9${FEE_MIN}\u2013\u20B9${FEE_MAX}.
                    Changes take effect immediately for new payments; renewals already paid are not affected.
                </p>
            </div>`;

        for (const [cityName, list] of groups) {
            if (isSA) {
                html += `<div style="font-size:11px;font-weight:700;letter-spacing:1px;
                                     text-transform:uppercase;color:var(--tx3);margin:14px 0 8px">
                            \u{1F3D9}\uFE0F ${escHtml(cityName)}
                        </div>`;
            }
            for (const n of list) html += _nigamCardHTML(n);
        }

        _container.innerHTML = html;
    }

    function _nigamCardHTML(n) {
        const reg = _num(n.registration_fee, 200);
        const ren = _num(n.renewal_fee,      150);
        const trf = _num(n.transfer_fee,     100);
        const updated = n.fees_updated_at
            ? new Date(n.fees_updated_at).toLocaleString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit"
              })
            : "Never edited";
        return `
        <div class="card" id="fee-card-${n.id}" style="margin-bottom:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px">
                <div style="min-width:0">
                    <div style="font-weight:700;font-size:14px">\u{1F3DB}\uFE0F ${escHtml(n.name)}</div>
                    <div style="font-size:11px;color:var(--tx3);margin-top:2px">
                        Last updated: ${escHtml(updated)}
                    </div>
                </div>
                <button class="btn btn-ghost btn-small btn-w-auto"
                        style="padding:6px 12px;font-size:12px"
                        onclick="FeeMgmt.openHistory(${n.id})">
                    \u{1F4DC} History
                </button>
            </div>
            <div class="d-row" style="gap:8px">
                ${_feeInputHTML(n.id, "registration_fee", "Registration", reg)}
                ${_feeInputHTML(n.id, "renewal_fee",      "Renewal",      ren)}
                ${_feeInputHTML(n.id, "transfer_fee",     "Transfer",     trf)}
            </div>
            <div id="fee-err-${n.id}" style="color:var(--er);font-size:12px;font-weight:600;
                                              margin-top:6px;display:none"></div>
            <div style="display:flex;justify-content:flex-end;margin-top:10px">
                <button id="fee-save-${n.id}" class="btn btn-primary btn-small btn-w-auto"
                        style="padding:8px 18px" onclick="FeeMgmt.saveNigam(${n.id})">
                    \u{1F4BE} Save
                </button>
            </div>
        </div>`;
    }

    function _feeInputHTML(nigamId, field, label, value) {
        return `
        <div class="field" style="margin-bottom:0;flex:1;min-width:0">
            <label class="field-label" style="font-size:11px">${escHtml(label)} (\u20B9)</label>
            <input id="fee-${field}-${nigamId}" class="field-input"
                type="number" step="0.01" min="${FEE_MIN}" max="${FEE_MAX}"
                value="${escHtml(String(value))}" />
        </div>`;
    }

    function _num(v, fallback) {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    }

    async function saveNigam(nigamId) {
        const errEl = document.getElementById(`fee-err-${nigamId}`);
        const btn   = document.getElementById(`fee-save-${nigamId}`);
        errEl.style.display = "none";
        errEl.textContent   = "";

        const reg = document.getElementById(`fee-registration_fee-${nigamId}`)?.value;
        const ren = document.getElementById(`fee-renewal_fee-${nigamId}`)?.value;
        const trf = document.getElementById(`fee-transfer_fee-${nigamId}`)?.value;

        // Client-side validation — server re-checks the same bounds.
        for (const [label, v] of [["Registration", reg], ["Renewal", ren], ["Transfer", trf]]) {
            const n = Number(v);
            if (!Number.isFinite(n) || n < FEE_MIN || n > FEE_MAX) {
                errEl.textContent = `${label} must be a number between \u20B9${FEE_MIN} and \u20B9${FEE_MAX}.`;
                errEl.style.display = "block";
                return;
            }
        }

        btn.classList.add("loading");
        btn.disabled = true;
        try {
            const updated = await AFP.PUT(`/api/geo/nigams/${nigamId}`, {
                registration_fee: Number(reg),
                renewal_fee:      Number(ren),
                transfer_fee:     Number(trf),
            });
            AFP.tst(updated.fee_changes > 0
                ? `Fees updated (${updated.fee_changes} field${updated.fee_changes === 1 ? "" : "s"}).`
                : "No fees changed.");
            // Refresh in-memory copy so "Last updated" is fresh next render
            const idx = _nigams.findIndex(x => x.id === nigamId);
            if (idx >= 0) {
                _nigams[idx] = { ..._nigams[idx], ...updated };
            }
            _render();
        } catch (ex) {
            errEl.textContent = ex.message || "Failed to save fees.";
            errEl.style.display = "block";
        } finally {
            btn.classList.remove("loading");
            btn.disabled = false;
        }
    }

    // ── History modal ────────────────────────────────────────────────────────
    async function openHistory(nigamId) {
        let modal = document.getElementById("fee-history-modal");
        if (!modal) {
            // Lazy-create modal shell so we don't bloat the base HTML
            const shell = document.createElement("div");
            shell.innerHTML = `
                <div id="fee-history-modal" class="modal-overlay" style="display:none">
                    <div class="modal-content" style="max-width:520px">
                        <div style="display:flex;justify-content:space-between;align-items:center;
                                    margin-bottom:12px">
                            <div style="font-size:16px;font-weight:700">\u{1F4DC} Fee History</div>
                            <button class="icon-btn" onclick="FeeMgmt.closeHistory()">\u2715</button>
                        </div>
                        <div id="fee-history-body" class="scroll" style="max-height:440px"></div>
                    </div>
                </div>`;
            document.body.appendChild(shell.firstElementChild);
            modal = document.getElementById("fee-history-modal");
        }
        const body = document.getElementById("fee-history-body");
        renderLoading(body);
        modal.style.display = "flex";

        try {
            const rows = await AFP.GET(`/api/geo/nigams/${nigamId}/fee-history`);
            if (!rows.length) {
                renderEmpty(body, "\u{1F4DC}", "No fee changes recorded yet.");
                return;
            }
            const labelOf = {
                registration_fee: "Registration",
                renewal_fee:      "Renewal",
                transfer_fee:     "Transfer",
            };
            body.innerHTML = rows.map(r => {
                const when = new Date(r.changed_at).toLocaleString("en-IN", {
                    day: "2-digit", month: "short", year: "numeric",
                    hour: "2-digit", minute: "2-digit"
                });
                const from = r.old_value != null ? `\u20B9${Number(r.old_value).toFixed(2)}` : "\u2014";
                const to   = `\u20B9${Number(r.new_value).toFixed(2)}`;
                return `
                <div class="card" style="margin-bottom:8px">
                    <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600">
                        <span>${escHtml(labelOf[r.field] || r.field)}</span>
                        <span style="color:var(--tx3);font-weight:400;font-size:11px">${escHtml(when)}</span>
                    </div>
                    <div style="margin-top:4px;font-size:13px">
                        <span style="color:var(--tx3)">${escHtml(from)}</span>
                        &nbsp;\u2192&nbsp;
                        <strong>${escHtml(to)}</strong>
                    </div>
                    <div style="margin-top:3px;font-size:11px;color:var(--tx3)">
                        by ${escHtml(r.changed_by_name || "\u2014")}
                    </div>
                </div>`;
            }).join("");
        } catch (ex) {
            body.innerHTML = alertBoxHTML("err", "Failed to load history: " + ex.message);
        }
    }

    function closeHistory() {
        const m = document.getElementById("fee-history-modal");
        if (m) m.style.display = "none";
    }

    return { loadFeeMgmt, saveNigam, openHistory, closeHistory };
})();
