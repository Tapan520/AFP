// ── AFP BUSINESS-APPLICATION APPROVAL MODULE ─────────────────────────────────
// Renders the Super Admin queue for vet/shop listing applications. Loaded
// from the Admin panel's "Listings" tab. Each row surfaces the applicant's
// contact info + a link to the uploaded verification doc so the reviewer
// can decide approve / reject in one screen.
//
// Server enforces super_admin on every write. This UI is a thin projection
// of /api/business/pending + /api/business/:id/approve|reject.
// ─────────────────────────────────────────────────────────────────────────────

const BusinessMgmt = (() => {
    let _container = null;
    let _apps      = [];
    let _filter    = "all";  // all | doctor | shop

    async function loadBusinessMgmt(container) {
        _container = container || document.getElementById("admin-body");
        const user = AFP.getUser();
        if (!_container || !user) return;
        if (user.role !== "super_admin") {
            _container.innerHTML = alertBoxHTML("warn", "Super Admin access required.");
            return;
        }
        await _reload();
    }

    async function _reload() {
        renderLoading(_container);
        try {
            _apps = await AFP.GET("/api/business/pending");
            _render();
        } catch (ex) {
            _container.innerHTML = alertBoxHTML("err", "Failed to load applications: " + ex.message);
        }
    }

    function _render() {
        const filtered = _filter === "all"
            ? _apps
            : _apps.filter(a => a.type === _filter);

        const chip = (val, label) => `
            <button class="chip ${_filter === val ? "active" : ""}"
                onclick="BusinessMgmt.setFilter('${val}')">${label}</button>`;

        let html = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px">
                <div>
                    <div style="font-size:17px;font-weight:700">\u{1F4CB} Vet / Shop Applications</div>
                    <div style="font-size:12px;color:var(--tx2);margin-top:2px">
                        Verify docs and approve. Approving copies the row into the public directory with a 1-year licence.
                    </div>
                </div>
                <button class="btn btn-ghost btn-small btn-w-auto" style="padding:6px 12px;font-size:12px"
                    onclick="BusinessMgmt.refresh()">\u{1F504} Refresh</button>
            </div>
            <div class="chips" style="margin-bottom:12px">
                ${chip("all",    `All (${_apps.length})`)}
                ${chip("doctor", `\u{1FA7A} Vets (${_apps.filter(a=>a.type==="doctor").length})`)}
                ${chip("shop",   `\u{1F6D2} Shops (${_apps.filter(a=>a.type==="shop").length})`)}
            </div>`;

        if (!filtered.length) {
            _container.innerHTML = html +
                emptyStateHTML("\u{1F4CB}", "No pending applications.", "");
            return;
        }

        html += filtered.map(_cardHTML).join("");
        _container.innerHTML = html;
    }

    function emptyStateHTML(icon, title, sub) {
        return `<div style="text-align:center;padding:32px 12px">
                    <div style="font-size:36px">${icon}</div>
                    <div style="font-weight:600;margin-top:8px">${escHtml(title)}</div>
                    ${sub ? `<div style="color:var(--tx3);font-size:12px;margin-top:4px">${escHtml(sub)}</div>` : ""}
                </div>`;
    }

    function _cardHTML(a) {
        const icon    = a.type === "doctor" ? "\u{1FA7A}" : "\u{1F6D2}";
        const created = new Date(a.created_at).toLocaleString("en-IN", {
            day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        });
        const statusPill = {
            draft:         badgeHTML("Draft",    "pn"),
            docs_uploaded: badgeHTML("Docs in",  "in"),
            paid:          badgeHTML("Paid",     "or"),
            approved:      badgeHTML("Approved", "ok"),
            rejected:      badgeHTML("Rejected", "rj"),
        }[a.status] || badgeHTML(a.status, "pn");
        const paidLine = a.payment_id
            ? `<div style="font-size:11px;color:var(--tx3)">
                 Razorpay: <code style="font-family:monospace">${escHtml(a.payment_id)}</code>
               </div>`
            : `<div style="font-size:11px;color:var(--er)">\u26A0\uFE0F Not paid yet \u2014 cannot approve until fee is captured.</div>`;
        const canApprove = a.status === "paid";
        return `
        <div class="card" id="ba-card-${a.id}" style="margin-bottom:11px">
            <div style="display:flex;gap:11px;align-items:flex-start;margin-bottom:10px">
                <div style="width:44px;height:44px;background:var(--or-p);border-radius:11px;
                            display:flex;align-items:center;justify-content:center;font-size:22px">
                    ${icon}
                </div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:14px">${escHtml(a.name)}</div>
                    <div style="font-size:12px;color:var(--tx2)">
                        ${escHtml(a.applicant_name || "\u2014")}
                        &middot; ${escHtml(a.applicant_mobile || a.mobile || "\u2014")}
                        ${a.applicant_email ? `&middot; ${escHtml(a.applicant_email)}` : ""}
                    </div>
                    <div style="font-size:11px;color:var(--tx3);margin-top:2px">Applied ${escHtml(created)}</div>
                </div>
                ${statusPill}
            </div>
            <div style="background:var(--sf2);border-radius:8px;padding:9px 10px;margin-bottom:9px;font-size:12px;color:var(--tx2)">
                ${a.type === "doctor" ? `
                    <div><strong>Qualification:</strong> ${escHtml(a.qualification || "\u2014")}</div>
                    <div><strong>Specialization:</strong> ${escHtml(a.specialization || "\u2014")}</div>
                    <div><strong>Clinic:</strong> ${escHtml(a.clinic_name || "\u2014")}</div>
                ` : `
                    <div><strong>Owner:</strong> ${escHtml(a.owner_name || "\u2014")}</div>
                    <div><strong>Speciality:</strong> ${escHtml(a.speciality || "\u2014")}</div>
                `}
                <div><strong>Address:</strong> ${escHtml(a.address || "\u2014")}</div>
                <div><strong>Licence no.:</strong> ${escHtml(a.licence_no || "\u2014")}</div>
                ${paidLine}
            </div>
            <div class="d-row" style="flex-wrap:wrap;gap:6px">
                ${a.docs_url ? `
                <a class="btn btn-outline btn-small btn-w-auto"
                    href="${escHtml(a.docs_url)}" target="_blank" rel="noopener"
                    style="padding:8px 12px;font-size:12px">
                    \u{1F4C4} View verification doc
                </a>` : `
                <span class="badge badge-pn">No doc uploaded</span>`}
                <button class="btn btn-success btn-small btn-w-auto"
                    style="padding:8px 14px;font-size:12px"
                    onclick="BusinessMgmt.approve(${a.id})"
                    ${canApprove ? "" : "disabled"}>
                    \u2705 Approve &amp; publish
                </button>
                <button class="btn btn-danger btn-small btn-w-auto"
                    style="padding:8px 14px;font-size:12px"
                    onclick="BusinessMgmt.reject(${a.id})">
                    \u274C Reject
                </button>
            </div>
        </div>`;
    }

    async function approve(id) {
        if (!confirm("Approve and publish this listing? It will be visible to citizens for the next 12 months.")) return;
        try {
            const r = await AFP.PATCH(`/api/business/${id}/approve`, { note: "" });
            AFP.tst(`Approved. Listing #${r.published_ref_id} live until ${r.licence_expiry_date}.`);
            await _reload();
        } catch (ex) { AFP.tst("Approve failed: " + ex.message); }
    }

    async function reject(id) {
        const reason = prompt("Reason for rejection (visible to applicant):");
        if (!reason || !reason.trim()) return;
        try {
            const r = await AFP.PATCH(`/api/business/${id}/reject`, { reason: reason.trim() });
            if (r.refund_status === "pending") {
                AFP.tst("Rejected. \u26A0\uFE0F Refund pending \u2014 process via Razorpay dashboard.");
            } else {
                AFP.tst("Rejected.");
            }
            await _reload();
        } catch (ex) { AFP.tst("Reject failed: " + ex.message); }
    }

    function setFilter(f) { _filter = f; _render(); }
    function refresh()    { _reload(); }

    return { loadBusinessMgmt, approve, reject, setFilter, refresh };
})();
