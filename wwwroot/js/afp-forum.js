// ?????????????????????????????????????????????????????????????????????????????
// afp-forum.js  –  Community Discussion Forum
//
// Browse threads · Create/Edit/Delete thread · View thread · Add/Edit/Delete replies
// ?????????????????????????????????????????????????????????????????????????????

const Forum = (() => {

    // ?? State ????????????????????????????????????????????????????????????????
    let _category     = "";
    let _searchQ      = "";
    let _threads      = [];
    let _activeThread = null;   // full thread object with .replies[]
    let _editReplyId  = null;   // id of reply being edited (null = new reply)

    // ?? Category config ??????????????????????????????????????????????????????
    const CATEGORIES = [
        { value: "",           label: "All",              icon: "&#x1F4AC;" },
        { value: "general",    label: "General",          icon: "&#x1F310;" },
        { value: "health",     label: "Health",           icon: "&#x1F3E5;" },
        { value: "training",   label: "Training",         icon: "&#x1F393;" },
        { value: "lostfound",  label: "Lost &amp; Found", icon: "&#x1F50D;" },
        { value: "nutrition",  label: "Nutrition",        icon: "&#x1F957;" },
        { value: "behaviour",  label: "Behaviour",        icon: "&#x1F9E0;" },
        { value: "other",      label: "Other",            icon: "&#x1F4CC;" },
    ];

    // ?? API helper ????????????????????????????????????????????????????????????
    async function _api(method, path, body) {
        const token   = AFP.getToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res  = await fetch(path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || data.message || "Request failed");
        return data;
    }

    // ?? Forum list ????????????????????????????????????????????????????????????
    async function loadForum() {
        const container = document.getElementById("forum-body");
        if (!container) return;
        _renderForumFrame(container);
        await _loadThreads();
    }

    function _renderForumFrame(container) {
        const catChips = CATEGORIES.map(c =>
            `<button class="chip forum-cat-chip${_category === c.value ? " active" : ""}"
                 data-cat="${c.value}" onclick="Forum.setCategory('${c.value}')">
                 ${c.icon}&nbsp;${c.label}
             </button>`
        ).join("");

        container.innerHTML = `
            <div style="padding:14px 14px 0">
                <div style="font-size:17px;font-weight:700;margin-bottom:12px">
                    &#x1F4AC; Community Forum
                </div>
                <div class="search-wrap" style="margin-bottom:12px">
                    <span class="search-icon">&#x1F50D;</span>
                    <input id="forum-search" class="field-input" style="padding-left:34px"
                        placeholder="Search discussions&hellip;"
                        oninput="Forum.onSearch(this.value)" />
                </div>
                <div class="chips" style="flex-wrap:wrap;margin-bottom:4px">${catChips}</div>
            </div>
            <div style="padding:10px 14px">
                <button class="btn btn-primary" style="width:100%;padding:11px"
                    onclick="Forum.openNewThreadModal()">
                    &#x2795;&nbsp; Start a Discussion
                </button>
            </div>
            <div id="forum-thread-list" style="padding:0 14px 24px"></div>`;
    }

    async function _loadThreads() {
        const listEl = document.getElementById("forum-thread-list");
        if (!listEl) return;
        renderLoading(listEl);
        try {
            const p = new URLSearchParams();
            if (_category) p.set("category", _category);
            if (_searchQ)  p.set("q",        _searchQ);
            _threads = await _api("GET", `/api/discussions?${p}`);
            _renderThreadList(listEl);
        } catch (ex) {
            listEl.innerHTML = alertBoxHTML("err", "Failed to load discussions: " + ex.message);
        }
    }

    function _renderThreadList(listEl) {
        if (!_threads || _threads.length === 0) {
            renderEmpty(listEl, "&#x1F4AC;", "No discussions yet \u2014 be the first!");
            return;
        }
        listEl.innerHTML = _threads.map(_threadCardHTML).join("");
    }

    function _threadCardHTML(t) {
        const cat = CATEGORIES.find(c => c.value === t.category) || CATEGORIES[1];
        return `
        <div class="card" style="cursor:pointer;margin-bottom:10px"
             onclick="Forum.openThread(${t.id})">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
                <div style="flex:1;min-width:0">
                    <div style="font-weight:600;font-size:14px;margin-bottom:4px;
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                        ${escHtml(t.title)}
                    </div>
                    <div style="font-size:12px;color:var(--tx2);margin-bottom:7px;
                                display:-webkit-box;-webkit-line-clamp:2;
                                -webkit-box-orient:vertical;overflow:hidden">
                        ${escHtml(t.body)}
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
                        <span class="badge badge-pn">${cat.icon}&nbsp;${escHtml(cat.label)}</span>
                        <span style="font-size:11px;color:var(--tx3)">
                            by ${escHtml(t.author_name || "Unknown")}
                            &middot; ${_timeAgo(t.created_at)}
                        </span>
                    </div>
                </div>
                <div style="text-align:center;flex-shrink:0;min-width:44px">
                    <div style="font-size:20px">&#x1F4AC;</div>
                    <div style="font-size:13px;font-weight:700;color:var(--tx2)">${t.reply_count || 0}</div>
                    <div style="font-size:10px;color:var(--tx3)">replies</div>
                </div>
            </div>
        </div>`;
    }

    // ?? Thread view ???????????????????????????????????????????????????????????
    async function openThread(threadId) {
        AFP.go("forumThread");
        const body = document.getElementById("forum-thread-body");
        if (body) renderLoading(body);
        _editReplyId = null;
        try {
            _activeThread = await _api("GET", `/api/discussions/${threadId}`);
            _renderThread();
        } catch (ex) {
            if (body) body.innerHTML = alertBoxHTML("err", "Failed to load thread: " + ex.message);
        }
    }

    function _renderThread() {
        const body = document.getElementById("forum-thread-body");
        if (!body || !_activeThread) return;
        const me       = AFP.getUser();
        const t        = _activeThread;
        const cat      = CATEGORIES.find(c => c.value === t.category) || CATEGORIES[1];
        const isAuthor = me && t.user_id === me.id;

        const repliesHTML = (t.replies && t.replies.length)
            ? t.replies.map(r => _replyHTML(r, me)).join("")
            : `<div style="text-align:center;color:var(--tx3);font-size:13px;padding:18px 0">
                   No replies yet \u2014 share your thoughts!
               </div>`;

        body.innerHTML = `
            <div class="card" style="margin-bottom:14px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;
                            gap:8px;margin-bottom:10px">
                    <span class="badge badge-pn">${cat.icon}&nbsp;${escHtml(cat.label)}</span>
                    ${isAuthor ? `
                    <div style="display:flex;gap:6px">
                        <button class="icon-btn" style="background:var(--bl-p);width:32px;height:32px"
                            title="Edit post" onclick="Forum.openEditThreadModal()">&#x270F;&#xFE0F;</button>
                        <button class="icon-btn" style="background:var(--er-p);width:32px;height:32px"
                            title="Delete post" onclick="Forum.confirmDeleteThread()">&#x1F5D1;&#xFE0F;</button>
                    </div>` : ""}
                </div>
                <div style="font-size:16px;font-weight:700;margin-bottom:8px">${escHtml(t.title)}</div>
                <div style="font-size:13px;color:var(--tx1);line-height:20px;
                            white-space:pre-wrap;word-break:break-word">
                    ${escHtml(t.body)}
                </div>
                <div style="font-size:11px;color:var(--tx3);margin-top:10px">
                    Posted by <strong>${escHtml(t.author_name || "Unknown")}</strong>
                    &middot; ${_timeAgo(t.created_at)}
                </div>
            </div>

            <div style="font-size:12px;font-weight:700;color:var(--tx2);text-transform:uppercase;
                        letter-spacing:.5px;margin-bottom:8px">
                ${t.replies ? t.replies.length : 0} Replies
            </div>
            <div id="forum-replies-list">${repliesHTML}</div>

            ${me ? `
            <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--bd)">
                <div style="font-size:13px;font-weight:600;margin-bottom:8px"
                     id="forum-reply-form-label">Write a Reply</div>
                <div id="forum-reply-err"
                     style="color:var(--er);font-size:12px;display:none;margin-bottom:6px"></div>
                <textarea id="forum-reply-input" class="field-input"
                    placeholder="Share your thoughts\u2026" rows="3"
                    style="resize:vertical;font-size:13px"></textarea>
                <div class="d-row" style="margin-top:10px">
                    <button class="btn btn-ghost" id="forum-cancel-edit-reply-btn"
                        style="display:none" onclick="Forum.cancelEditReply()">Cancel</button>
                    <button class="btn btn-primary" onclick="Forum.saveReply()">
                        &#x1F4BE; Post Reply
                    </button>
                </div>
            </div>` : `
            <div class="alert-box alert-info" style="margin-top:14px">
                <span>&#x2139;&#xFE0F;</span>
                <p>Please <a href="javascript:void(0)" onclick="AFP.go('login')">login</a> to reply.</p>
            </div>`}`;
    }

    function _replyHTML(r, me) {
        const isAuthor = me && r.user_id === me.id;
        return `
        <div class="card" style="margin-bottom:8px" id="forum-reply-${r.id}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:600;color:var(--bl);margin-bottom:5px">
                        ${escHtml(r.author_name || "Unknown")}
                        <span style="font-weight:400;color:var(--tx3)">&middot; ${_timeAgo(r.created_at)}</span>
                    </div>
                    <div style="font-size:13px;line-height:19px;color:var(--tx1);
                                white-space:pre-wrap;word-break:break-word">
                        ${escHtml(r.body)}
                    </div>
                </div>
                ${isAuthor ? `
                <div style="display:flex;gap:5px;flex-shrink:0">
                    <button class="icon-btn" style="background:var(--bl-p);width:30px;height:30px"
                        title="Edit reply" onclick="Forum.startEditReply(${r.id})">&#x270F;&#xFE0F;</button>
                    <button class="icon-btn" style="background:var(--er-p);width:30px;height:30px"
                        title="Delete reply" onclick="Forum.deleteReply(${r.id})">&#x1F5D1;&#xFE0F;</button>
                </div>` : ""}
            </div>
        </div>`;
    }

    // ?? New / Edit thread modal ???????????????????????????????????????????????
    function openNewThreadModal() {
        if (!AFP.getUser()) { AFP.go("login"); return; }
        _openThreadModal(null);
    }

    function openEditThreadModal() {
        if (!_activeThread) return;
        _openThreadModal(_activeThread);
    }

    function _openThreadModal(thread) {
        const modal   = document.getElementById("forum-thread-modal");
        const titleEl = document.getElementById("forum-thread-modal-title");
        const bodyEl  = document.getElementById("forum-thread-modal-body");
        const errEl   = document.getElementById("forum-thread-modal-err");
        if (!modal) return;
        errEl.innerHTML = "";
        titleEl.textContent = thread ? "Edit Discussion" : "Start a Discussion";

        const catOpts = CATEGORIES.filter(c => c.value).map(c =>
            `<option value="${c.value}"${thread && thread.category === c.value ? " selected" : ""}>
                 ${c.label}
             </option>`
        ).join("");

        bodyEl.innerHTML = `
            <div class="field">
                <label class="field-label">Title *</label>
                <input id="ftm-title" class="field-input" maxlength="200"
                    value="${escHtml(thread ? thread.title : "")}"
                    placeholder="What do you want to discuss?" />
                <div id="ftm-title-err" class="um-field-err"></div>
            </div>
            <div class="field">
                <label class="field-label">Category *</label>
                <select id="ftm-category" class="field-input">${catOpts}</select>
            </div>
            <div class="field">
                <label class="field-label">Details *</label>
                <textarea id="ftm-body" class="field-input" rows="5"
                    style="resize:vertical;font-size:13px"
                    placeholder="Describe your topic in detail\u2026">${escHtml(thread ? thread.body : "")}</textarea>
                <div id="ftm-body-err" class="um-field-err"></div>
            </div>`;

        modal.style.display = "flex";
    }

    function closeThreadModal() {
        const m = document.getElementById("forum-thread-modal");
        if (m) m.style.display = "none";
    }

    async function saveThread() {
        const errEl = document.getElementById("forum-thread-modal-err");
        const btn   = document.getElementById("forum-thread-modal-save-btn");
        errEl.innerHTML = "";

        const title    = (document.getElementById("ftm-title")?.value    || "").trim();
        const category =  document.getElementById("ftm-category")?.value || "general";
        const body     = (document.getElementById("ftm-body")?.value     || "").trim();

        function _fe(id, msg) {
            const e = document.getElementById(`${id}-err`);
            const i = document.getElementById(id);
            if (e) { e.textContent = msg; e.style.display = msg ? "block" : "none"; }
            if (i) { i.style.borderColor = msg ? "var(--er)" : ""; i.style.background = msg ? "var(--er-p)" : ""; }
            return !!msg;
        }
        let hasErr = false;
        if (!title) hasErr = _fe("ftm-title", "Title is required.")    || hasErr;
        if (!body)  hasErr = _fe("ftm-body",  "Details are required.") || hasErr;
        if (hasErr) return;

        btn.classList.add("loading"); btn.disabled = true;
        try {
            const isEdit = document.getElementById("forum-thread-modal-title")?.textContent === "Edit Discussion";
            if (isEdit && _activeThread) {
                await _api("PUT", `/api/discussions/${_activeThread.id}`, { title, body, category });
                AFP.tst("Discussion updated \u2705");
                closeThreadModal();
                await openThread(_activeThread.id);
            } else {
                await _api("POST", "/api/discussions", { title, body, category });
                AFP.tst("Discussion started! \uD83C\uDF89");
                closeThreadModal();
                await _loadThreads();
            }
        } catch (ex) {
            errEl.innerHTML = alertBoxHTML("err", ex.message || "Failed to save. Please try again.");
        } finally { btn.classList.remove("loading"); btn.disabled = false; }
    }

    // ?? Delete thread ?????????????????????????????????????????????????????????
    function confirmDeleteThread() {
        if (!_activeThread) return;
        const modal = document.getElementById("forum-confirm-modal");
        const msgEl = document.getElementById("forum-confirm-msg");
        if (!modal) return;
        msgEl.innerHTML = `Delete the thread <strong>${escHtml(_activeThread.title)}</strong>?
                           All replies will be removed. This cannot be undone.`;
        modal._deleteType = "thread";
        modal.style.display = "flex";
    }

    // ?? Delete reply ??????????????????????????????????????????????????????????
    function deleteReply(replyId) {
        const modal = document.getElementById("forum-confirm-modal");
        const msgEl = document.getElementById("forum-confirm-msg");
        if (!modal) return;
        msgEl.innerHTML = "Delete this reply? This action cannot be undone.";
        modal._deleteType    = "reply";
        modal._deleteReplyId = replyId;
        modal.style.display = "flex";
    }

    async function executeConfirm() {
        const modal = document.getElementById("forum-confirm-modal");
        const btn   = document.getElementById("forum-confirm-del-btn");
        if (!modal) return;
        btn.classList.add("loading"); btn.disabled = true;
        try {
            if (modal._deleteType === "thread" && _activeThread) {
                await _api("DELETE", `/api/discussions/${_activeThread.id}`);
                AFP.tst("Thread deleted.");
                closeConfirmModal();
                _activeThread = null;
                AFP.go("forum");
                await _loadThreads();
            } else if (modal._deleteType === "reply" && modal._deleteReplyId && _activeThread) {
                await _api("DELETE", `/api/discussions/${_activeThread.id}/replies/${modal._deleteReplyId}`);
                AFP.tst("Reply deleted.");
                closeConfirmModal();
                _activeThread = await _api("GET", `/api/discussions/${_activeThread.id}`);
                _renderThread();
            }
        } catch (ex) {
            AFP.tst("Failed: " + ex.message);
            closeConfirmModal();
        } finally { btn.classList.remove("loading"); btn.disabled = false; }
    }

    function closeConfirmModal() {
        const m = document.getElementById("forum-confirm-modal");
        if (m) { m.style.display = "none"; delete m._deleteType; delete m._deleteReplyId; }
    }

    // ?? Reply actions ?????????????????????????????????????????????????????????
    function startEditReply(replyId) {
        if (!_activeThread) return;
        const reply = (_activeThread.replies || []).find(r => r.id === replyId);
        if (!reply) return;
        _editReplyId = replyId;
        const input     = document.getElementById("forum-reply-input");
        const label     = document.getElementById("forum-reply-form-label");
        const cancelBtn = document.getElementById("forum-cancel-edit-reply-btn");
        if (input)  { input.value = reply.body; input.focus(); }
        if (label)  label.textContent = "Edit Reply";
        if (cancelBtn) cancelBtn.style.display = "";
        input?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function cancelEditReply() {
        _editReplyId = null;
        const input     = document.getElementById("forum-reply-input");
        const label     = document.getElementById("forum-reply-form-label");
        const cancelBtn = document.getElementById("forum-cancel-edit-reply-btn");
        if (input)  input.value = "";
        if (label)  label.textContent = "Write a Reply";
        if (cancelBtn) cancelBtn.style.display = "none";
    }

    async function saveReply() {
        const input  = document.getElementById("forum-reply-input");
        const errEl  = document.getElementById("forum-reply-err");
        const body   = (input?.value || "").trim();

        if (errEl) { errEl.textContent = ""; errEl.style.display = "none"; }
        if (!body) {
            if (errEl) { errEl.textContent = "Reply cannot be empty."; errEl.style.display = "block"; }
            return;
        }
        try {
            if (_editReplyId) {
                await _api("PUT", `/api/discussions/${_activeThread.id}/replies/${_editReplyId}`, { body });
                AFP.tst("Reply updated \u2705");
            } else {
                await _api("POST", `/api/discussions/${_activeThread.id}/replies`, { body });
                AFP.tst("Reply posted! \uD83D\uDC3E");
            }
            cancelEditReply();
            _activeThread = await _api("GET", `/api/discussions/${_activeThread.id}`);
            _renderThread();
        } catch (ex) {
            if (errEl) { errEl.textContent = ex.message || "Failed to post reply."; errEl.style.display = "block"; }
        }
    }

    // ?? Category / search ?????????????????????????????????????????????????????
    function setCategory(val) {
        _category = val;
        document.querySelectorAll(".forum-cat-chip").forEach(c =>
            c.classList.toggle("active", c.dataset.cat === val));
        _loadThreads();
    }

    function onSearch(val) { _searchQ = val; _loadThreads(); }

    // ?? Utility ???????????????????????????????????????????????????????????????
    function _timeAgo(ts) {
        if (!ts) return "";
        const secs = Math.floor((Date.now() - new Date(ts)) / 1000);
        if (secs < 60)    return "just now";
        if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
        if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
        return `${Math.floor(secs / 86400)}d ago`;
    }

    return {
        loadForum, openThread,
        openNewThreadModal, openEditThreadModal, saveThread, closeThreadModal,
        confirmDeleteThread, deleteReply, executeConfirm, closeConfirmModal,
        startEditReply, cancelEditReply, saveReply,
        setCategory, onSearch,
    };
})();
