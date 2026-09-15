# 07 — Conventions & Gotchas

## Code Style

### JavaScript
- **Vanilla ES2020+**, no build step, no bundler.
- Modules are IIFEs: `const Foo = (() => { … return { publicApi }; })();`
- All DOM access via `document.getElementById(...)?...` — the `?.` is important on shared screens.
- HTML built as template literals; **always** escape user data through `escHtml()`.
- Toasts via `AFP.tst("message")` — never `alert()`.
- Section banner headers use `// ?? SECTION ????…` (the "?" chars are stylistic; keep them intact when editing near them).

### C#
- Minimal APIs, no controllers.
- `await using` for `NpgsqlConnection` / `NpgsqlCommand` / `NpgsqlDataReader`.
- Positional parameters `$1, $2, …` with `NpgsqlParameter { Value = … }`.
- Serialise responses with `Results.Json(...)`.
- Never leak connection strings — see `dbConnectError`/`dbInitError` handling in `/api/dbstatus`.

### CSS
- Design tokens live in `:root` — see [`04-frontend-structure.md`](./04-frontend-structure.md).
- Prefer utility classes already in `afp.css` (`.p-18`, `.pb-32`, `.mt-8`, `.d-row`, `.gap-8`, `.center`, `.d-none`).

## Naming

| Kind | Convention |
|---|---|
| Screen `<div>` id | `screen-<camelCase>` |
| Modal `<div>` id | `<prefix>-modal` (e.g. `um-modal`, `doc-modal`) |
| Error banner id | `<prefix>-err` (e.g. `login-err`, `um-modal-err`) |
| Field id | `<prefix>-<field>` (e.g. `reg-name`, `np-breed`) |
| Save button id | `<prefix>-btn` or `<prefix>-modal-save-btn` |

## Known Gotchas (bug patterns to avoid)

### 1. `AFP.logout()` hides every `[id$='-err']` element

It sets `style.display = "none"` on every error span to reset field validation.
This has previously hidden banner containers (`login-err`, `al-err`, `reg-err`)
permanently after a logout.

**Fix pattern** (already applied in `afp-auth.js`):

```js
err.innerHTML     = "";
err.style.display = "";   // ? must reset display, not just innerHTML
```

Any new banner container (`<div id="something-err">…</div>`) must apply the
same reset before writing new content.

### 2. Legacy global aliases via `Object.defineProperty`

`afp-pets.js` / `afp-admin.js` mirror their encapsulated `PetState` / `AdminState`
to the old `_currentPet`, `_adminTab`, `_geoView`, etc. globals so inline
`onclick=` handlers keep working. **Do not remove these aliases** unless you
rewrite the corresponding `onclick=` attributes in `Index.cshtml`.

### 3. Script order matters

`afp-screens.js` uses functions from every other module. It **must stay last**
in `_AppLayout.cshtml`. New modules go above it.

### 4. `_patchedGo` in `Index.cshtml`

Screen loaders that need form initialisation (`initNewPet`, `initRenew`, …) are
wired up **only** inside the `<script>` block at the bottom of `Index.cshtml`.
If you add a new form screen, register it there too, not just in `AFP.go`'s
`loaders` map.

### 5. Upload proxies must not stringify the body

`/api/pets/{id}/upload-photo` and `/upload-certificate` stream bytes with
`StreamContent`. The generic POST catch-all uses `StreamReader.ReadToEndAsync()`
which corrupts multipart bodies. Keep the specific uploads registered **before**
the catch-all.

### 6. False-positive duplicate function names

`renderAdminTabBar` contains `renderAdminTab` as a substring; `generateCertificateById`
contains `generateCertificate`. Grep with **word boundaries** (`\b` or
`function name\b`), not plain substring, when checking for dupes.

### 7. Startup migrations use `Console.WriteLine` on error, do not throw

Each `RunSql(...)` call catches its own exception and logs a warning. This is
intentional so a bad migration on one column does not stop the server. Preserve
this pattern.

### 8. JWT signature is *not* verified on .NET side

`GetUserId(req)` decodes the payload without checking the signature. This is
acceptable because signature verification happens on the Node side (or the DB
call would fail anyway due to missing/invalid ids). Do **not** rely on it for
authorization decisions in isolation — always cross-check DB state.

### 9. `escHtml()` also escapes `'` and `"`

Necessary because we embed values in `onclick="foo('${escHtml(name)}')"`
attributes. Do not swap it for a lighter escaper.

### 10. Never call `alert()` / `confirm()` / `prompt()`

Use `AFP.tst()` for toast messages and the existing modal templates in
`Index.cshtml` for confirmations.
