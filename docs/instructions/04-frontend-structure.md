# 04 — Frontend Structure

## Layout Files

| File | Role |
|---|---|
| `Pages/Shared/_AppLayout.cshtml` | Sole layout used by `Index.cshtml`; loads CSS + JS |
| `Pages/Shared/_Layout.cshtml` | Default MVC layout — only used by `Privacy.cshtml` / `Error.cshtml` |
| `Pages/Index.cshtml` | Contains **every app screen** as a hidden `<div id="screen-*" class="afp-screen d-none">` |
| `Pages/Payment.cshtml` | Standalone page hosting the Razorpay handlers in `Payment.cshtml.cs` |

## Script Load Order (critical)

Defined in `_AppLayout.cshtml`:

```
afp-core.js
afp-components.js
afp-validation.js
<Razorpay CDN>
afp-payment.js
afp-usermgmt.js
afp-doctorshop-mgmt.js
afp-forum.js
afp-features.js
afp-auth.js       ??  These must be
afp-pets.js        ?  after all deps
afp-admin.js      ??
afp-screens.js     ? orchestrator (uses everything above)
```

Any new module goes **before** `afp-screens.js`.

## Screen Router

Implemented as `AFP.go(screenName)` in `afp-core.js`:

1. Hides every `.afp-screen` by adding `d-none`.
2. Un-hides `#screen-<name>`.
3. Calls the matching loader from a `loaders` dictionary (`dashboard ? loadDashboard`, etc.).

The **section `@section Scripts` in `Index.cshtml`** *augments* `AFP.go` after
load: it wraps the original in `_patchedGo` to run screen-specific `init*` hooks
(`initNewPet`, `initRenew`, `initReportPet`, `initNewOwner`, `Forum.loadForum`,
`loadSearchDoctor/Shop`, `loadBreedingMatch`). Keep this pattern when adding a
screen with a form: register its `init*` in that `_patchedGo`.

## Screens (IDs)

```
screen-splash, screen-login, screen-register, screen-adminLogin,
screen-dashboard, screen-searchPet, screen-notifications,
screen-vaxReminders, screen-adoption, screen-lostFound, screen-emergencyVet,
screen-microchip, screen-events, screen-profile, screen-petProfile,
screen-newPet, screen-renew, screen-reportPet, screen-newOwner,
screen-searchDoctor, screen-searchShop, screen-breedingMatch,
screen-petMeter, screen-admin, screen-forum, screen-forumThread
```

Plus modals: `doc-modal`, `shop-modal`, `qr-modal`, `pay-modal`, `um-modal`,
`um-confirm-modal`, `dm-modal`, `sm-modal`, `photo-modal`, `breed-modal`,
`rc-modal`, `geo-modal`, `event-add-modal`, `adoption-modal`,
`forum-thread-modal`, `forum-confirm-modal`.

## Bottom Navigation

`.bnav` bars appear on Dashboard, PetMeter, Profile. Routed by `bnavGo(key)` in
`afp-components.js` — mapping:

```
home ? dashboard | search ? searchPet | meter ? petMeter | profile ? profile
```

## CSS Design Tokens (from `wwwroot/css/afp.css`)

```
--or  #E8670A      Primary orange       --or-d darker    --or-p pale
--bl  #1E6FD9      Info blue            --bl-p pale
--dk  #1A1814      Dark surface         --sf / --sf2 light surfaces
--tx  main text    --tx2 secondary      --tx3 muted     --bd border
--ok  green        --wn amber           --er red        (each has *-p pale variant)
```

Use these variables — never hard-code hex.
