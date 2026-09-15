# 00 — Overview

## What is AFP?

**All For Pets (AFP)** is a mobile-first, single-page web application that lets citizens
and municipal staff manage the city pet registry. Citizens register pets, renew licences,
transfer ownership, report strays and browse vets, shops and adoption/breeding matches.
Municipal admins approve registrations, manage staff and view billing/revenue reports.

Target device: **phone-sized viewport** (`max-width: 480px`). All screens are inside a
single Razor Page (`Pages/Index.cshtml`) and switched by a JS router (`AFP.go`).

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend UI | Razor Pages (.NET 8) + vanilla JS modules |
| .NET server | ASP.NET Core Minimal APIs in `Program.cs` (proxy + direct-DB endpoints) |
| Auxiliary backend | Node.js + Express (in `railway-backend/`) — used for pet CRUD, file uploads, auth JWTs |
| Database | PostgreSQL (Railway-hosted) |
| Auth | JWT issued by the Node backend, stored in `localStorage` |
| Payments | Razorpay (server-side proxy in `Pages/Payment.cshtml.cs`) |

## High-level Folder Layout

```
AFP/
??? AFP.csproj                        ? Razor Pages project (net8.0, Npgsql 7)
??? Program.cs                        ? Startup + all /api/* endpoints
??? Pages/
?   ??? Index.cshtml (+ .cs)          ? All app screens as <div id="screen-*">
?   ??? Payment.cshtml (+ .cs)        ? Razorpay create-order / verify endpoints
?   ??? Error.cshtml                  ? Fallback error page
?   ??? Shared/
?       ??? _AppLayout.cshtml         ? Loads afp-*.js in strict order (used by Index)
?       ??? _Layout.cshtml            ? Bootstrap fallback layout (used only by Error)
??? wwwroot/
?   ??? css/afp.css                   ? Single stylesheet (design tokens as CSS vars)
?   ??? js/afp-*.js                   ? 13 modules (see 05-frontend-modules.md)
??? railway-backend/                  ? Node/Express backend (deployed separately)
?   ??? server.js, db.js
?   ??? routes/*.js                   ? auth, geo, pets, doctors, shops, reports, discussions, adminUsers
?   ??? middleware/auth.js
??? docs/instructions/                ? YOU ARE HERE
```

## The Two Personas

| Persona | Login screen | Landing screen |
|---|---|---|
| **Citizen** | `#screen-login` | `#screen-dashboard` |
| **Municipal Staff** (any `*_admin` role) | `#screen-adminLogin` | `#screen-admin` |

Both call the same endpoint `POST /api/auth/login`. Role is decided by `user.role`.
