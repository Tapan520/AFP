﻿// ?? AFP CORE - API, Auth, Router, Toast ???????????????????????????????????????
const AFP = (() => {
    // Relative URLs - all calls route through the .NET proxy (dev->localhost:3000, prod->Railway).
    // This ensures the JWT is signed and verified by the SAME backend - fixes "Invalid or expired token".
    const API_BASE = "";

    let _token = null;
    let _user  = null;
    try {
        _token = localStorage.getItem("afp_token") || null;
        _user  = JSON.parse(localStorage.getItem("afp_user") || "null");
    } catch { _token = null; _user = null; }

    let _toastTimer    = null;
    let _selectedPetId = null;

    // ?? API Layer ?????????????????????????????????????????????????????????????
    async function api(method, path, body) {
        const headers = { "Content-Type": "application/json" };
        if (_token) headers["Authorization"] = `Bearer ${_token}`;
        const res  = await fetch(`${API_BASE}${path}`, {
            method, headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || "Request failed");
        return data;
    }

    async function uploadFile(path, file, fieldName = "photo") {
        const formData = new FormData();
        formData.append(fieldName, file);
        const headers = {};
        if (_token) headers["Authorization"] = `Bearer ${_token}`;
        const res  = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || "Upload failed");
        return data;
    }

    const GET    = (path)       => api("GET",    path);
    const POST   = (path, body) => api("POST",   path, body);
    const PATCH  = (path, body) => api("PATCH",  path, body);
    const PUT    = (path, body) => api("PUT",    path, body);
    const DELETE = (path)       => api("DELETE", path);

    // ?? Utils ?????????????????????????????????????????????????????????????????
    const spIco = (s) => ({ dog: "\uD83D\uDC36", cat: "\uD83D\uDC31", rabbit: "\uD83D\uDC30", bird: "\uD83D\uDC26" }[s] || "\uD83D\uDC3E");
    const daysTo = (d) => d ? Math.ceil((new Date(d) - Date.now()) / 86_400_000) : null;
    const fmt    = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "\u2014";

    // ?? Toast ?????????????????????????????????????????????????????????????????
    function tst(msg) {
        const el = document.getElementById("afp-toast");
        if (!el) return;
        el.textContent = msg;
        el.classList.remove("hidden");
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => el.classList.add("hidden"), 2800);
    }

    // ?? Router ????????????????????????????????????????????????????????????????
    function go(screen) {
        document.querySelectorAll(".afp-screen").forEach(s => s.classList.add("d-none"));
        const target = document.getElementById(`screen-${screen}`);
        if (target) {
            target.classList.remove("d-none");
            const loaders = {
                dashboard:     loadDashboard,
                searchPet:     loadSearchPet,
                petMeter:      loadPetMeter,
                profile:       loadProfile,
                admin:         loadAdmin,
                notifications: loadNotifications,
                vaxReminders:  loadVaccineReminders,
                adoption:      loadAdoption,
                lostFound:     loadLostFound,
                emergencyVet:  loadEmergencyVet,
                microchip:     loadMicrochip,
                events:        loadEvents,
            };
            if (loaders[screen]) loaders[screen]();
        } else {
            document.getElementById("screen-splash")?.classList.remove("d-none");
        }
        window.scrollTo(0, 0);
    }

    // ?? Auth ??????????????????????????????????????????????????????????????????
    function login(user, token) {
        _token = token;
        _user  = user;
        localStorage.setItem("afp_token", token);
        localStorage.setItem("afp_user",  JSON.stringify(user));
    }

    function logout() {
        // 1. Wipe in-memory auth state
        _token         = null;
        _user          = null;
        _selectedPetId = null;

        // 2. Wipe ALL persisted storage for this origin
        localStorage.removeItem("afp_token");
        localStorage.removeItem("afp_user");
        try { sessionStorage.clear(); } catch { }

        // 3. Close every open modal
        document.querySelectorAll(".modal-bg").forEach(m => {
            m.style.display = "none";
            // clear any stored delete-target refs on the modal element
            delete m._delId; delete m._delName; delete m._saveHandler;
        });

        // 4. Reset all HTML forms (clears input values, selects, textareas)
        document.querySelectorAll("form").forEach(f => { try { f.reset(); } catch { } });

        // 5. Strip field-level error styling left from previous session
        document.querySelectorAll(".field-input").forEach(el => {
            el.style.borderColor = "";
            el.style.background  = "";
        });
        document.querySelectorAll("[id$='-err']").forEach(el => {
            el.innerHTML    = "";
            el.style.display = "none";
        });

        // 6. Clear per-screen _initialized flags so forms re-initialise on next login
        ["renew-pet", "to-pet"].forEach(id => {
            const el = document.getElementById(id);
            if (el) delete el._initialized;
        });
        ["newpet-form", "rp-form"].forEach(id => {
            const el = document.getElementById(id);
            if (el) delete el._initialized;
        });

        // 7. Navigate to splash
        go("splash");
    }

    // ?? Accessors ?????????????????????????????????????????????????????????????
    function getUser()          { return _user; }
    function getToken()         { return _token; }
    function getSelectedPetId() { return _selectedPetId; }
    function setSelectedPetId(id) { _selectedPetId = id; }

    return {
        GET, POST, PATCH, PUT, DELETE, uploadFile,
        spIco, daysTo, fmt,
        tst, go,
        login, logout,
        getUser, getToken,
        getSelectedPetId, setSelectedPetId,
    };
})();
