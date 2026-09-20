// ── AFP RATINGS MODULE ──────────────────────────────────────────────────────
// Pet-owner feedback / ratings for Doctors & Shops.
//
// UX design:
//   • Accessible from a "⭐ Ratings & Feedback" tile on the citizen dashboard.
//   • ONE screen — filter chips switch between Doctors and Shops.
//   • Each row shows the target's name/details, current community avg, and
//     an inline 5-star selector. If the user has previously rated it, the
//     stars + comment are prefilled.
//   • Submitting overwrites the user's prior rating (server does UPSERT so
//     only the latest rating per (user, target) survives).
//   • No need to visit the doctor's / shop's own profile page.
//
// Backend contract lives in railway-backend/routes/ratings.js.
// ────────────────────────────────────────────────────────────────────────────
const Ratings = (() => {
    let _type    = "doctor";           // "doctor" | "shop"
    let _search  = "";
    let _targets = [];

    async function load() {
        const body = document.getElementById("ratings-body");
        if (!body) return;
        const user = AFP.getUser();
        if (!user || !["citizen", "super_admin"].includes(user.role)) {
            body.innerHTML = alertBoxHTML("warn",
                "Only pet owners can leave feedback and ratings.");
            return;
        }
        body.innerHTML = `
            <div style="padding:14px 15px 4px">
                <div style="font-size:20px;font-weight:700;margin-bottom:4px">
                    &#x2B50; Ratings &amp; Feedback
                </div>
                <div style="font-size:13px;color:var(--tx2)">
                    Rate any vet or pet-shop directly &mdash; no need to open their profile.
                    Only your latest rating per business is kept.
                </div>
            </div>
            <div style="padding:12px 15px 0">
                <div class="chips">
                    <button class="chip ratings-type-chip active" data-type="doctor"
                        onclick="Ratings.setType(this,'doctor')">&#x1FA7A; Doctors</button>
                    <button class="chip ratings-type-chip" data-type="shop"
                        onclick="Ratings.setType(this,'shop')">&#x1F6D2; Shops</button>
                </div>
                <div class="search-wrap" style="margin-top:8px">
                    <span class="search-icon">&#x1F50D;</span>
                    <input id="ratings-q" class="field-input" style="padding-left:34px"
                        placeholder="Search by name or mobile&hellip;"
                        oninput="Ratings.onSearch(this.value)" />
                </div>
            </div>
            <div id="ratings-list" style="padding:12px 15px 24px"></div>`;
        await _loadTargets();
    }

    function setType(el, type) {
        _type = type;
        document.querySelectorAll(".ratings-type-chip").forEach(c => c.classList.remove("active"));
        el?.classList.add("active");
        _loadTargets();
    }

    let _searchTimer = null;
    function onSearch(val) {
        _search = val || "";
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(_loadTargets, 250);
    }

    async function _loadTargets() {
        const list = document.getElementById("ratings-list");
        if (!list) return;
        renderLoading(list);
        try {
            const q = _search ? `&q=${encodeURIComponent(_search)}` : "";
            _targets = await AFP.GET(`/api/ratings/targets?type=${_type}${q}`);
            if (!_targets.length) {
                renderEmpty(list, _type === "doctor" ? "\u{1FA7A}" : "\u{1F6D2}",
                    _search ? "No matches." : `No ${_type === "doctor" ? "vets" : "shops"} available yet.`);
                return;
            }
            list.innerHTML = _targets.map(_cardHTML).join("");
        } catch (ex) {
            list.innerHTML = alertBoxHTML("err", "Failed to load: " + ex.message);
        }
    }

    function _starHTML(t, filled) {
        // 5 clickable stars per row. `t.id` is used as the state key.
        let out = `<div class="star-row" role="radiogroup" aria-label="Rate this ${_type}"
                        data-target="${t.id}" style="gap:2px">`;
        for (let i = 1; i <= 5; i++) {
            const on = i <= filled;
            out += `<button type="button" class="rating-star"
                        data-target="${t.id}" data-stars="${i}"
                        onclick="Ratings.pick(${t.id},${i})"
                        style="background:none;border:none;font-size:26px;line-height:1;
                               padding:2px 3px;cursor:pointer;color:${on ? "#F5B301" : "#D0CBC2"}">
                        ${on ? "\u2605" : "\u2606"}
                    </button>`;
        }
        out += `</div>`;
        return out;
    }

    function _avgHTML(avg, cnt) {
        if (!cnt) return `<span style="font-size:11px;color:var(--tx3)">No ratings yet</span>`;
        return `<span style="font-size:12px;color:var(--tx2);font-weight:600">
                    &#x2B50; ${Number(avg).toFixed(1)}
                    <span style="color:var(--tx3);font-weight:400">(${cnt})</span>
                </span>`;
    }

    function _cardHTML(t) {
        const icon    = _type === "doctor" ? "\u{1FA7A}" : "\u{1F6D2}";
        const subtitle = _type === "doctor"
            ? [t.clinic_name, t.specialization].filter(Boolean).map(escHtml).join(" &middot; ")
            : [t.owner_name, t.speciality].filter(Boolean).map(escHtml).join(" &middot; ");
        const geo = [t.ward_number, t.city_name].filter(Boolean).map(escHtml).join(", ");
        const filled = Number(t.my_stars || 0);
        const mine   = t.my_rating_id
            ? badgeHTML(`Your rating: ${filled}\u2605`, "or")
            : "";
        return `
        <div class="card" id="rating-card-${t.id}" style="margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <div style="width:44px;height:44px;border-radius:11px;background:var(--or-p);
                            display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
                    ${icon}
                </div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:600;font-size:14px">${escHtml(t.name || "")}</div>
                    ${subtitle ? `<div style="font-size:12px;color:var(--tx2);margin-top:2px">${subtitle}</div>` : ""}
                    ${geo ? `<div style="font-size:11px;color:var(--tx3);margin-top:2px">&#x1F4CD; ${geo}</div>` : ""}
                </div>
                <div style="text-align:right;flex-shrink:0">
                    ${_avgHTML(t.avg_stars, t.rating_count)}
                    ${mine ? `<div style="margin-top:4px">${mine}</div>` : ""}
                </div>
            </div>
            ${_starHTML(t, filled)}
            <textarea id="rating-comment-${t.id}" class="field-input"
                placeholder="Add a short comment (optional)&hellip;"
                rows="2"
                style="margin-top:8px;font-size:13px;resize:vertical">${escHtml(t.my_comment || "")}</textarea>
            <div id="rating-err-${t.id}" style="color:var(--er);font-size:12px;font-weight:600;
                                                margin-top:4px;display:none"></div>
            <div class="d-row" style="margin-top:8px">
                <button id="rating-save-${t.id}" class="btn btn-primary btn-small"
                    onclick="Ratings.save(${t.id})">
                    &#x1F4BE; ${t.my_rating_id ? "Update rating" : "Submit rating"}
                </button>
                ${t.my_rating_id ? `
                <button class="btn btn-ghost btn-small"
                    onclick="Ratings.remove(${t.my_rating_id},${t.id})">
                    &#x1F5D1;&#xFE0F; Remove
                </button>` : ""}
            </div>
        </div>`;
    }

    // Highlight the clicked star (and everything to the left of it).
    function pick(targetId, stars) {
        const row = document.querySelector(`.star-row[data-target="${targetId}"]`);
        if (!row) return;
        row.querySelectorAll(".rating-star").forEach(btn => {
            const n = Number(btn.dataset.stars);
            btn.textContent    = n <= stars ? "\u2605" : "\u2606";
            btn.style.color    = n <= stars ? "#F5B301" : "#D0CBC2";
        });
        row.dataset.stars = stars;
    }

    function _selectedStars(targetId) {
        const row = document.querySelector(`.star-row[data-target="${targetId}"]`);
        if (row?.dataset.stars) return Number(row.dataset.stars);
        // Fallback: derive from currently filled glyphs.
        return (row?.querySelectorAll(".rating-star") ?? [])
            .toArray?.().filter(b => b.textContent === "\u2605").length || 0;
    }

    async function save(targetId) {
        const errEl = document.getElementById(`rating-err-${targetId}`);
        const btn   = document.getElementById(`rating-save-${targetId}`);
        errEl.style.display = "none";
        errEl.textContent   = "";
        const row = document.querySelector(`.star-row[data-target="${targetId}"]`);
        let stars = 0;
        if (row?.dataset.stars) stars = Number(row.dataset.stars);
        else if (row) {
            stars = Array.from(row.querySelectorAll(".rating-star"))
                .filter(b => b.textContent === "\u2605").length;
        }
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
            errEl.textContent = "Please pick 1 to 5 stars first.";
            errEl.style.display = "block";
            return;
        }
        const comment = document.getElementById(`rating-comment-${targetId}`)?.value.trim() || "";
        btn.classList.add("loading");
        btn.disabled = true;
        try {
            await AFP.POST("/api/ratings", {
                targetType: _type,
                targetId,
                stars,
                comment,
            });
            AFP.tst("Thanks for your feedback!");
            await _loadTargets();
        } catch (ex) {
            errEl.textContent = ex.message || "Failed to save rating.";
            errEl.style.display = "block";
        } finally {
            btn.classList.remove("loading");
            btn.disabled = false;
        }
    }

    async function remove(ratingId, targetId) {
        if (!confirm("Remove your rating for this listing?")) return;
        try {
            await AFP.DELETE(`/api/ratings/${ratingId}`);
            AFP.tst("Rating removed.");
            await _loadTargets();
        } catch (ex) {
            AFP.tst("Failed: " + ex.message);
        }
    }

    return { load, setType, onSearch, pick, save, remove };
})();

// Global alias — mirrors the pattern used by other screens in afp-core.js.
function loadRatings() { return Ratings.load(); }
