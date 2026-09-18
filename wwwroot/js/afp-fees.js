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
            <div style="font-size:11px;font-weight:700;color:var(--tx2);text-transform:uppercase;letter-spacing:.6px;margin:4px 0 6px">
                Flat fees (fallback)
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
                    \u{1F4BE} Save flat fees
                </button>
            </div>
            <div style="border-top:1px dashed var(--bd);margin:14px 0 10px"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <div>
                    <div style="font-weight:700;font-size:13px">\u{1F415} Per-species &amp; size rates</div>
                    <div style="font-size:11px;color:var(--tx3);margin-top:2px">
                        Overrides the flat fee above when a pet matches. Leave blank to fall back.
                    </div>
                </div>
                <button class="btn btn-ghost btn-small btn-w-auto"
                        style="padding:6px 12px;font-size:12px"
                        onclick="FeeMgmt.toggleRules(${n.id})">
                    <span id="fee-rules-toggle-${n.id}">Show \u25BE</span>
                </button>
            </div>
            <div id="fee-rules-${n.id}" style="display:none"></div>
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

    // ── Per-species / size rate matrix ───────────────────────────────────────
    // Loaded lazily when the admin clicks "Show" on a nigam card. The GET
    // returns the full matrix (4 buckets) already padded with nulls, so we
    // just render inputs directly. Empty inputs are treated as "no override"
    // on save — the server deletes those rows so we fall back to the flat fee.
    const RULE_BUCKETS = [
        { species: "dog",   size_category: "large_aggressive", label: "\u{1F415} Dog \u2014 Large / Aggressive" },
        { species: "dog",   size_category: "small",            label: "\u{1F429} Dog \u2014 Small" },
        { species: "cat",   size_category: "single",           label: "\u{1F431} Cat" },
        { species: "other", size_category: "single",           label: "\u{1F430} Other (Rabbit / Bird / \u2026)" },
    ];

    async function toggleRules(nigamId) {
        const host   = document.getElementById(`fee-rules-${nigamId}`);
        const toggle = document.getElementById(`fee-rules-toggle-${nigamId}`);
        if (!host) return;
        if (host.style.display === "none") {
            host.style.display = "block";
            toggle.textContent = "Hide \u25B4";
            if (!host.dataset.loaded) {
                renderLoading(host);
                try {
                    const rules = await AFP.GET(`/api/geo/nigams/${nigamId}/fee-rules`);
                    _renderRuleMatrix(nigamId, host, rules);
                    host.dataset.loaded = "1";
                } catch (ex) {
                    host.innerHTML = alertBoxHTML("err", "Failed to load rate matrix: " + ex.message);
                }
            }
        } else {
            host.style.display = "none";
            toggle.textContent = "Show \u25BE";
        }
    }

    function _renderRuleMatrix(nigamId, host, rules) {
        // Index by (species|size) for quick lookup
        const byKey = new Map((rules || []).map(r => [`${r.species}|${r.size_category}`, r]));
        const rows  = RULE_BUCKETS.map(b => {
            const r    = byKey.get(`${b.species}|${b.size_category}`) || {};
            const reg  = r.registration_fee != null ? r.registration_fee : "";
            const ren  = r.renewal_fee      != null ? r.renewal_fee      : "";
            const trf  = r.transfer_fee     != null ? r.transfer_fee     : "";
            const rid  = `${b.species}_${b.size_category}`;
            return `
            <div style="border:1px solid var(--bd);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--sf2)">
                <div style="font-size:13px;font-weight:700;margin-bottom:6px">${b.label}</div>
                <div class="d-row" style="gap:8px">
                    ${_ruleInputHTML(nigamId, rid, "reg", "Registration", reg)}
                    ${_ruleInputHTML(nigamId, rid, "ren", "Renewal",      ren)}
                    ${_ruleInputHTML(nigamId, rid, "trf", "Transfer",     trf)}
                </div>
                <input type="hidden" id="rule-${nigamId}-${rid}-sp"   value="${b.species}" />
                <input type="hidden" id="rule-${nigamId}-${rid}-size" value="${b.size_category}" />
            </div>`;
        }).join("");

        host.innerHTML = `
            <div class="alert-box alert-info" style="margin-bottom:10px">
                <span>\u2139\uFE0F</span>
                <p style="font-size:12px">
                    Leave a field <strong>blank</strong> to use the flat fee above.
                    Values here take priority for matching pets.
                </p>
            </div>
            ${rows}
            <div id="rule-err-${nigamId}" style="color:var(--er);font-size:12px;font-weight:600;
                                                margin-top:6px;display:none"></div>
            <div style="display:flex;justify-content:flex-end;margin-top:6px">
                <button id="rule-save-${nigamId}" class="btn btn-primary btn-small btn-w-auto"
                        style="padding:8px 18px" onclick="FeeMgmt.saveRules(${nigamId})">
                    \u{1F4BE} Save rate matrix
                </button>
            </div>`;
    }

    function _ruleInputHTML(nigamId, rid, field, label, value) {
        return `
        <div class="field" style="margin-bottom:0;flex:1;min-width:0">
            <label class="field-label" style="font-size:11px">${escHtml(label)} (\u20B9)</label>
            <input id="rule-${nigamId}-${rid}-${field}" class="field-input"
                type="number" step="0.01" min="${FEE_MIN}" max="${FEE_MAX}"
                placeholder="\u2014"
                value="${escHtml(String(value))}" />
        </div>`;
    }

    async function saveRules(nigamId) {
        const errEl = document.getElementById(`rule-err-${nigamId}`);
        const btn   = document.getElementById(`rule-save-${nigamId}`);
        errEl.style.display = "none";
        errEl.textContent   = "";

        const rules = [];
        for (const b of RULE_BUCKETS) {
            const rid = `${b.species}_${b.size_category}`;
            const regRaw = document.getElementById(`rule-${nigamId}-${rid}-reg`)?.value;
            const renRaw = document.getElementById(`rule-${nigamId}-${rid}-ren`)?.value;
            const trfRaw = document.getElementById(`rule-${nigamId}-${rid}-trf`)?.value;
            const rowVals = { reg: regRaw, ren: renRaw, trf: trfRaw };
            for (const [k, v] of Object.entries(rowVals)) {
                if (v === "" || v == null) continue;
                const n = Number(v);
                if (!Number.isFinite(n) || n < FEE_MIN || n > FEE_MAX) {
                    errEl.textContent = `${b.label} \u2014 ${k} must be between \u20B9${FEE_MIN} and \u20B9${FEE_MAX}.`;
                    errEl.style.display = "block";
                    return;
                }
            }
            rules.push({
                species:          b.species,
                size_category:    b.size_category,
                registration_fee: regRaw === "" ? null : Number(regRaw),
                renewal_fee:      renRaw === "" ? null : Number(renRaw),
                transfer_fee:     trfRaw === "" ? null : Number(trfRaw),
            });
        }

        btn.classList.add("loading");
        btn.disabled = true;
        try {
            const r = await AFP.PUT(`/api/geo/nigams/${nigamId}/fee-rules`, { rules });
            AFP.tst(`Rate matrix saved (${r.saved} row${r.saved === 1 ? "" : "s"}, ${r.cleared} cleared).`);
        } catch (ex) {
            errEl.textContent = ex.message || "Failed to save rate matrix.";
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
            // Lazy-create modal shell using the app's standard modal-bg /
            // modal-sheet classes so it looks and behaves like every other
            // dialog (bottom sheet on mobile, centred on desktop).
            const shell = document.createElement("div");
            shell.innerHTML = `
                <div id="fee-history-modal" class="modal-bg" style="display:none">
                    <div class="modal-sheet">
                        <div class="modal-handle"></div>
                        <div style="display:flex;align-items:center;justify-content:space-between;
                                    margin-bottom:14px">
                            <div style="font-size:16px;font-weight:700">\u{1F4DC} Fee History</div>
                            <button style="background:none;border:none;font-size:20px;
                                           color:var(--tx3);cursor:pointer;line-height:1"
                                onclick="FeeMgmt.closeHistory()">&times;</button>
                        </div>
                        <div id="fee-history-body" class="scroll"
                             style="max-height:60vh;overflow-y:auto;padding-right:4px"></div>
                        <button class="btn btn-ghost mt-8"
                                onclick="FeeMgmt.closeHistory()">Close</button>
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

    return { loadFeeMgmt, saveNigam, openHistory, closeHistory, toggleRules, saveRules };
})();
