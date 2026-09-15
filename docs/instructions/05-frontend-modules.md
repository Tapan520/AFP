# 05 — Frontend JS Modules

All modules live in `wwwroot/js/`. Each starts with a banner
`// ?? MODULE NAME ????…` and lists its dependencies.

## Module Map

| File | Exports (top-level globals) | Depends on |
|---|---|---|
| `afp-core.js` | `AFP` IIFE — API layer, router, auth, toast | — |
| `afp-components.js` | `renderLoading`, `renderEmpty`, `alertBoxHTML`, `petCardHTML`, `badgeHTML`, `infoRowHTML`, `escHtml`, `bottomNavHTML`, `bnavGo`, `populatePicker`, `petBadgeHTML` | `AFP` |
| `afp-validation.js` | `Validate` IIFE — `injectErrorContainers`, `attachLive`, `validateForm`, `clearForm`, `validateField`, `RULES` | — |
| `afp-payment.js` | `Payment` IIFE — modal open/close, `startPayment`, Razorpay integration | `AFP` |
| `afp-usermgmt.js` | `UserMgmt` IIFE — full user CRUD UI, role-scoped | `AFP`, `Validate`, `components` |
| `afp-doctorshop-mgmt.js` | `DoctorMgmt`, `ShopMgmt` IIFEs — geo-filtered admin CRUD | same |
| `afp-forum.js` | `Forum` IIFE — thread/reply CRUD + modals | `AFP`, `components` |
| `afp-features.js` | Vaccine reminders, adoption, lost & found, emergency vet, microchip, events, notifications, QR-code modal helpers | `AFP`, `components` |
| `afp-auth.js` | `initLogin`, `initRegister`, `initAdminLogin` | `AFP`, `Validate`, `components` |
| `afp-pets.js` | `PetState` (encapsulated), `loadPetProfile`, `renderPetProfileHeader`, `petProfileSetTab`, `initNewPet`, `initRenew`, `initReportPet`, `initNewOwner`, `openPet`, `generateCertificate`, `generateCertificateById`, `handleNewPetPhoto`, `handleNewPetCert`, breeding-match screens | many |
| `afp-admin.js` | `AdminState` (encapsulated), `loadAdmin`, `adminSetTab`, `renderAdminTab*`, geo manager, report/comment modals, billing screen | many |
| `afp-screens.js` | Orchestrator — Dashboard, Profile, Search Pet, Pet Meter, Search Doctor/Shop screens + `DOMContentLoaded` bootstrap | everything |
| `site.js` | ASP.NET Core default template stub (unused) | — |

## `AFP` (core) surface

```js
AFP.GET(path)           AFP.POST(path, body)      AFP.PATCH(...)   AFP.PUT(...)   AFP.DELETE(...)
AFP.uploadFile(path, file, fieldName='photo')     // multipart
AFP.go(screenName)                                // router
AFP.login(user, token)  AFP.logout()              // storage + reset UI
AFP.getUser()           AFP.getToken()
AFP.getSelectedPetId()  AFP.setSelectedPetId(id)
AFP.tst(message)                                  // toast
AFP.spIco(species)      AFP.daysTo(dateStr)       AFP.fmt(dateStr)
```

## Encapsulated State Pattern (introduced in commit `82d3818`)

`afp-pets.js` and `afp-admin.js` keep state inside a `PetState` / `AdminState`
object, then expose the *legacy* global names (`_currentPet`, `_adminTab`,
`_geoView`, …) via `Object.defineProperty(window, '_x', { get, set })`. Inline
`onclick=` handlers in Razor keep working without change. Follow this pattern
when refactoring further.

## Adding a New Screen

1. Add `<div id="screen-foo" class="afp-screen screen d-none">…</div>` in `Index.cshtml`.
2. Add a loader: `async function loadFoo() { … }` in a suitable module (usually `afp-screens.js` or a feature-specific file).
3. Register it either in the `loaders` map inside `afp-core.js` `go()` **or** as
   an `if (screen === 'foo') setTimeout(initFoo, 50);` inside the `_patchedGo` in `Index.cshtml`.
4. If a form is on the screen, define an `initFoo` that uses `Validate.injectErrorContainers` + `Validate.attachLive`.
5. Follow the CSS classes: `topbar`, `scroll`, `p-18 pb-32`, `bnav`, `field`, `field-input`, `btn btn-primary`, `card`, etc.

## Adding a New JS Module

1. Create `wwwroot/js/afp-<name>.js`.
2. Add the banner header + `// Depends on:` comment.
3. Insert its `<script>` tag in `_AppLayout.cshtml` **before** `afp-screens.js` and after its dependencies.
