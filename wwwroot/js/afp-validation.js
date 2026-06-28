// ??? AFP VALIDATION MODULE ????????????????????????????????????????????????????
// Provides real-time field validation and form-level validation helpers.

const Validate = (() => {

    // ?? Rules ?????????????????????????????????????????????????????????????????
    const RULES = {
        required:  (v)         => v.trim() !== ""                          || "This field is required.",
        minLen:    (n)         => (v) => v.trim().length >= n              || `Minimum ${n} characters required.`,
        maxLen:    (n)         => (v) => v.trim().length <= n              || `Maximum ${n} characters allowed.`,
        mobile:    (v)         => /^[6-9]\d{9}$/.test(v.trim())           || "Enter a valid 10-digit Indian mobile number.",
        email:     (v)         => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || "Enter a valid email address.",
        password:  (v)         => v.length >= 6                            || "Password must be at least 6 characters.",
        noFuture:  (v)         => { if (!v) return "Date is required."; return new Date(v) <= new Date() || "Date cannot be in the future."; },
        select:    (v)         => v !== "" && v !== null && v !== undefined || "Please select an option.",
    };

    // ?? Field definitions per form ????????????????????????????????????????????
    const FORMS = {
        login: [
            { id: "login-id", label: "Mobile or Email", rules: [RULES.required, (v) => (v.includes("@") ? RULES.email(v) : (/^[6-9]\d{9}$/.test(v.trim()) ? true : "Enter a valid mobile number or email."))] },
            { id: "login-pw", label: "Password",        rules: [RULES.required] },
        ],

        register: [
            { id: "reg-name",  label: "Full name",  rules: [RULES.required, RULES.minLen(3), RULES.maxLen(60)] },
            { id: "reg-mob",   label: "Mobile",     rules: [RULES.required, RULES.mobile] },
            { id: "reg-email", label: "Email",      rules: [RULES.required, RULES.email] },
            { id: "reg-addr",  label: "Address",    rules: [RULES.required, RULES.minLen(5)] },
            { id: "reg-city",  label: "City",       rules: [RULES.required, RULES.select], type: "select" },
            { id: "reg-nigam", label: "Nigam",      rules: [RULES.required, RULES.select], type: "select" },
            { id: "reg-zone",  label: "Zone",       rules: [(v) => { const el = document.getElementById("reg-zone-field"); if (el && el.style.display === "none") return true; return v !== "" || "Please select a zone."; }], type: "select" },
            { id: "reg-ward",  label: "Ward",       rules: [(v) => { const el = document.getElementById("reg-ward-field"); if (el && el.style.display === "none") return true; return v !== "" || "Please select a ward."; }], type: "select" },
            { id: "reg-pw",    label: "Password",   rules: [RULES.required, RULES.password] },
        ],

        adminLogin: [
            { id: "al-id", label: "Staff ID / Email", rules: [RULES.required] },
            { id: "al-pw", label: "Password",         rules: [RULES.required] },
        ],

        newPet: [
            { id: "np-name",   label: "Pet name",      rules: [RULES.required, RULES.minLen(2), RULES.maxLen(40)] },
            { id: "np-breed",  label: "Breed",         rules: [RULES.required, RULES.minLen(2)] },
            { id: "np-colour", label: "Colour",        rules: [RULES.required, RULES.minLen(2)] },
            { id: "np-dob",    label: "Date of birth", rules: [RULES.required, RULES.noFuture] },
        ],

        reportPet: [
            { id: "rp-addr",   label: "Last seen address", rules: [RULES.required, RULES.minLen(5)] },
            { id: "rp-mobile", label: "Your mobile",       rules: [RULES.required, RULES.mobile] },
        ],

        transfer: [
            { id: "to-pet",    label: "Pet",               rules: [RULES.required, RULES.select], type: "select" },
            { id: "to-name",   label: "New owner's name",  rules: [RULES.required, RULES.minLen(3)] },
            { id: "to-mobile", label: "New owner's mobile",rules: [RULES.required, RULES.mobile] },
        ],
    };

    // ?? Internal helpers ??????????????????????????????????????????????????????

    function _getErrEl(fieldId) {
        return document.getElementById(`${fieldId}-err`);
    }

    function _setFieldError(fieldId, message) {
        const input = document.getElementById(fieldId);
        const errEl = _getErrEl(fieldId);
        if (input) {
            input.style.borderColor = "var(--er)";
            input.style.background  = "var(--er-p)";
        }
        if (errEl) {
            errEl.textContent = message;
            errEl.style.display = "block";
        }
    }

    function _clearFieldError(fieldId) {
        const input = document.getElementById(fieldId);
        const errEl = _getErrEl(fieldId);
        if (input) {
            input.style.borderColor = "";
            input.style.background  = "";
        }
        if (errEl) {
            errEl.textContent = "";
            errEl.style.display = "none";
        }
    }

    function _validateField(field) {
        const el = document.getElementById(field.id);
        if (!el) return true;
        const val = el.value ?? "";
        for (const rule of field.rules) {
            const result = rule(val);
            if (result !== true) {
                _setFieldError(field.id, result);
                return false;
            }
        }
        _clearFieldError(field.id);
        return true;
    }

    // ?? Public API ????????????????????????????????????????????????????????????

    /** Inject per-field inline error containers next to all known inputs */
    function injectErrorContainers(formName) {
        const fields = FORMS[formName];
        if (!fields) return;
        fields.forEach(f => {
            const el = document.getElementById(f.id);
            if (!el) return;
            if (document.getElementById(`${f.id}-err`)) return; // already injected
            const errSpan = document.createElement("div");
            errSpan.id = `${f.id}-err`;
            errSpan.style.cssText = "color:var(--er);font-size:11px;font-weight:600;margin-top:3px;margin-bottom:4px;display:none;";
            el.parentNode.insertBefore(errSpan, el.nextSibling);
        });
    }

    /** Attach live blur/change validation to a form's fields */
    function attachLive(formName) {
        const fields = FORMS[formName];
        if (!fields) return;
        fields.forEach(f => {
            const el = document.getElementById(f.id);
            if (!el) return;
            const evt = (f.type === "select") ? "change" : "blur";
            el.addEventListener(evt, () => _validateField(f));
            // Clear error on any input so user gets instant feedback
            el.addEventListener("input", () => _clearFieldError(f.id));
        });
    }

    /**
     * Validate all fields for a form.
     * @returns {boolean} true if all valid
     */
    function validateForm(formName) {
        const fields = FORMS[formName];
        if (!fields) return true;
        let valid = true;
        let firstInvalidId = null;
        fields.forEach(f => {
            const ok = _validateField(f);
            if (!ok && valid) { valid = false; firstInvalidId = f.id; }
            if (!ok && !firstInvalidId) firstInvalidId = f.id;
        });
        if (firstInvalidId) {
            document.getElementById(firstInvalidId)?.scrollIntoView({ behavior: "smooth", block: "center" });
            document.getElementById(firstInvalidId)?.focus();
        }
        return valid;
    }

    /** Clear all errors for a form */
    function clearForm(formName) {
        const fields = FORMS[formName];
        if (!fields) return;
        fields.forEach(f => _clearFieldError(f.id));
    }

    /** Validate a single field immediately */
    function validateField(fieldId) {
        for (const [, fields] of Object.entries(FORMS)) {
            const f = fields.find(x => x.id === fieldId);
            if (f) return _validateField(f);
        }
        return true;
    }

    return { injectErrorContainers, attachLive, validateForm, clearForm, validateField, RULES };
})();
