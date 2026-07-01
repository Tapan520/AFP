// ?? Auth Screens: Login / Register / Admin Login ?????????????????????????????
// Extracted from afp-screens.js for maintainability.
// Depends on: AFP (afp-core), Validate (afp-validation), alertBoxHTML / populatePicker (afp-components)

// ?? SCREEN: LOGIN ????????????????????????????????????????????????????????????
function initLogin() {
    const form = document.getElementById("login-form");
    if (!form) return;
    Validate.injectErrorContainers("login");
    Validate.attachLive("login");
    form.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!Validate.validateForm("login")) return;
        const id  = document.getElementById("login-id").value.trim();
        const pw  = document.getElementById("login-pw").value;
        const err = document.getElementById("login-err");
        const btn = document.getElementById("login-btn");
        err.innerHTML     = "";
        err.style.display = "";
        btn.classList.add("loading");
        try {
            const { token, user } = await AFP.POST("/api/auth/login", { identifier: id, password: pw });
            AFP.login(user, token);
            AFP.go(user.role === "citizen" ? "dashboard" : "admin");
        } catch (ex) {
            err.innerHTML = alertBoxHTML("err", ex.message || "Login failed");
        } finally { btn.classList.remove("loading"); }
    });
}

// ?? SCREEN: REGISTER ??????????????????????????????????????????????????????????
async function initRegister() {
    const cityEl  = document.getElementById("reg-city");
    const nigamEl = document.getElementById("reg-nigam");
    const zoneEl  = document.getElementById("reg-zone");
    const wardEl  = document.getElementById("reg-ward");
    const zoneFld = document.getElementById("reg-zone-field");
    const wardFld = document.getElementById("reg-ward-field");
    if (!cityEl) return;

    Validate.injectErrorContainers("register");
    Validate.attachLive("register");

    // Zone and Ward fields are hidden until cascaded
    if (zoneFld) zoneFld.style.display = "none";
    if (wardFld) wardFld.style.display = "none";

    try {
        const cities = await AFP.GET("/api/geo/cities");
        populatePicker(cityEl, cities.map(c => ({ label: c.name, value: c.id })), "Select city...");
    } catch { }

    cityEl.addEventListener("change", async function () {
        populatePicker(nigamEl, [], "Select nigam...");
        populatePicker(zoneEl,  [], "Select zone...");
        populatePicker(wardEl,  [], "Select ward...");
        if (zoneFld) zoneFld.style.display = "none";
        if (wardFld) wardFld.style.display = "none";
        if (!this.value) return;
        try {
            const nigams = await AFP.GET(`/api/geo/nigams?cityId=${this.value}`);
            populatePicker(nigamEl, nigams.map(n => ({ label: n.name, value: n.id })), "Select nigam...");
        } catch { }
    });

    nigamEl.addEventListener("change", async function () {
        populatePicker(zoneEl, [], "Select zone...");
        populatePicker(wardEl, [], "Select ward...");
        if (zoneFld) zoneFld.style.display = "none";
        if (wardFld) wardFld.style.display = "none";
        if (!this.value) return;
        try {
            const zones = await AFP.GET(`/api/geo/zones?nigamId=${this.value}`);
            populatePicker(zoneEl, zones.map(z => ({ label: z.name, value: z.id })), "Select zone...");
            if (zoneFld) zoneFld.style.display = "";
        } catch { }
    });

    zoneEl.addEventListener("change", async function () {
        populatePicker(wardEl, [], "Select ward...");
        if (wardFld) wardFld.style.display = "none";
        if (!this.value) return;
        try {
            const wards = await AFP.GET(`/api/geo/wards?zoneId=${this.value}`);
            populatePicker(wardEl, wards.map(w => ({ label: w.ward_number, value: w.id })), "Select ward...");
            if (wardFld) wardFld.style.display = "";
        } catch { }
    });

    document.getElementById("reg-form").addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!Validate.validateForm("register")) return;
        const err = document.getElementById("reg-err");
        const btn = document.getElementById("reg-btn");
        err.innerHTML     = "";
        err.style.display = "";
        btn.classList.add("loading");
        try {
            const { token, user } = await AFP.POST("/api/auth/register", {
                name:     document.getElementById("reg-name").value.trim(),
                mobile:   document.getElementById("reg-mob").value.trim(),
                email:    document.getElementById("reg-email").value.trim(),
                password: document.getElementById("reg-pw").value,
                address:  document.getElementById("reg-addr").value.trim(),
                cityId:  +cityEl.value  || undefined,
                nigamId: +nigamEl.value || undefined,
                zoneId:  +zoneEl.value  || undefined,
                wardId:  +wardEl.value  || undefined,
            });
            AFP.login(user, token);
            AFP.go("dashboard");
        } catch (ex) {
            err.innerHTML = alertBoxHTML("err", ex.message || "Registration failed");
        } finally { btn.classList.remove("loading"); }
    });
}

// ?? SCREEN: ADMIN LOGIN ???????????????????????????????????????????????????????
function initAdminLogin() {
    const form = document.getElementById("adminlogin-form");
    if (!form) return;
    Validate.injectErrorContainers("adminLogin");
    Validate.attachLive("adminLogin");
    form.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!Validate.validateForm("adminLogin")) return;
        const id  = document.getElementById("al-id").value.trim();
        const pw  = document.getElementById("al-pw").value;
        const err = document.getElementById("al-err");
        const btn = document.getElementById("al-btn");
        err.innerHTML     = "";
        err.style.display = "";
        btn.classList.add("loading");
        try {
            const { token, user } = await AFP.POST("/api/auth/login", { identifier: id, password: pw });
            if (user.role === "citizen") throw new Error("Not an admin account. Please use the citizen login.");
            AFP.login(user, token);
            AFP.go("admin");
        } catch (ex) {
            err.innerHTML = alertBoxHTML("err", ex.message || "Login failed");
        } finally { btn.classList.remove("loading"); }
    });
}
