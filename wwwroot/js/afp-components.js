// ?? SHARED UI COMPONENTS ?????????????????????????????????????????????????????

/** Render a loading spinner into a container element */
function renderLoading(container) {
    if (!container) return;
    container.innerHTML = `
        <div class="center">
            <span class="spinner mini-spinner"
                  style="width:32px;height:32px;border-width:3px;margin-bottom:12px;"></span>
            <span style="color:var(--tx2);font-size:14px;">Loading&hellip;</span>
        </div>`;
}

/** Render an empty-state placeholder into a container */
function renderEmpty(container, icon, text) {
    if (!container) return;
    container.innerHTML = `
        <div class="center">
            <div class="center-icon">${icon}</div>
            <div class="center-text">${escHtml(text)}</div>
        </div>`;
}

/** Build an alert box HTML string */
function alertBoxHTML(type, message) {
    const icons = { info: "&#x2139;&#xFE0F;", warn: "&#x26A0;&#xFE0F;", ok: "&#x2705;", err: "&#x274C;" };
    return `<div class="alert-box alert-${type}">
                <span>${icons[type] || "&#x2139;&#xFE0F;"}</span>
                <p>${escHtml(message)}</p>
            </div>`;
}

/** Build a pet card HTML string */
function petCardHTML(pet, onclick) {
    return `
        <div class="pet-card" onclick="${onclick}">
            <div class="pet-avatar">${AFP.spIco(pet.species)}</div>
            <div class="pet-info">
                <div class="pet-name">${escHtml(pet.name)}</div>
                <div class="pet-sub">${escHtml(pet.breed || "")} &middot; ${escHtml(pet.gender || "")}</div>
                <div class="pet-id-lbl mono">${escHtml(pet.pet_id || "Pending ID")}</div>
            </div>
            ${petBadgeHTML(pet)}
        </div>`;
}

/** Return badge HTML for a pet's registration status */
function petBadgeHTML(pet) {
    if (pet.registration_status === "approved") {
        if (pet.licence_status === "expiring_soon") return badgeHTML("Expiring", "ex");
        return badgeHTML("Active", "ok");
    }
    if (pet.registration_status === "pending")  return badgeHTML("Pending",  "pn");
    if (pet.registration_status === "rejected") return badgeHTML("Rejected", "rj");
    return "";
}

/** Build a badge HTML string */
function badgeHTML(label, type) {
    return `<span class="badge badge-${type}">${escHtml(label)}</span>`;
}

/** Build an info-row HTML string (label / value pair) */
function infoRowHTML(label, value, mono) {
    const display = (value !== null && value !== undefined && String(value).trim() !== "")
        ? escHtml(String(value))
        : "&mdash;";
    return `<div class="info-row">
                <span class="info-label">${escHtml(label)}</span>
                <span class="info-value${mono ? " mono" : ""}">${display}</span>
            </div>`;
}

/** HTML-escape a string to prevent XSS */
function escHtml(str) {
    return String(str ?? "")
        .replace(/&/g,  "&amp;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;")
        .replace(/"/g,  "&quot;")
        .replace(/'/g,  "&#x27;");
}

/** Build bottom navigation bar HTML */
function bottomNavHTML(active) {
    const items = [
        ["home",    "&#x1F3E0;", "Home"],
        ["search",  "&#x1F50D;", "Search"],
        ["meter",   "&#x1F4CA;", "Stats"],
        ["profile", "&#x1F464;", "Profile"],
    ];
    return `<div class="bnav">
        ${items.map(([k, ic, l]) => `
            <div class="bnav-item${active === k ? " active" : ""}" onclick="bnavGo('${k}')">
                <span class="bnav-icon">${ic}</span>
                <span class="bnav-lbl">${l}</span>
            </div>`).join("")}
    </div>`;
}

/** Route bottom nav clicks */
function bnavGo(key) {
    const map = { home: "dashboard", search: "searchPet", meter: "petMeter", profile: "profile" };
    AFP.go(map[key] || "dashboard");
}

/** Populate a <select> element with options */
function populatePicker(selectEl, options, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = `<option value="">${escHtml(placeholder || "Select...")}</option>`;
    (options || []).forEach(o => {
        const opt = document.createElement("option");
        opt.value       = o.value;
        opt.textContent = o.label;
        selectEl.appendChild(opt);
    });
}
