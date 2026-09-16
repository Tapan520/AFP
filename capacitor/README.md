# All For Pets — Mobile Wrapper (Capacitor)

The web UI in `wwwroot/` is already mobile-first (max-width 480px shell, bottom
nav, sticky top bar). Capacitor lets us package it as a native **Android** and
**iOS** application without rewriting a single line.

## One-time setup

```powershell
# 1. Install Capacitor CLI + platform packages (declared in package.json)
npm install

# 2. Point Capacitor at the deployed URL (already set in capacitor.config.json
#    to https://afp.up.railway.app). Change it before the first build if
#    your production origin is different.

# 3. Add the native shells
npm run cap:add:android
npm run cap:add:ios       # (macOS only — needs Xcode)

# 4. Copy web assets & install native plugins
npm run cap:sync
```

This creates `./android/` (Gradle project) and `./ios/` (Xcode workspace) as
siblings of the .NET project.

## Iterative dev loop

```powershell
# Rebuild wwwroot (if you changed anything) …
dotnet build

# … push it into the native shells
npm run cap:sync

# Open in Android Studio / Xcode
npm run cap:open:android
npm run cap:open:ios
```

Or run straight onto a connected device / simulator:

```powershell
npm run cap:run:android
npm run cap:run:ios
```

## What is bundled inside the app?

Because `capacitor.config.json` sets `server.url` to the deployed backend, the
built APK / IPA is a thin native chrome that loads the live web app inside a
WebView. Advantages:

* Instant updates — deploy the .NET app and every install picks up the change
  on next launch. No app-store review for content updates.
* Auth, payment, storage & CDN configuration flow through the same code paths
  as the browser.
* Razorpay checkout still works (its host is in `allowNavigation`).

If you want to ship the assets **inside** the app instead (offline-first), just
delete `server.url` from `capacitor.config.json` and re-run `npm run cap:sync`;
Capacitor will copy everything under `wwwroot/` into the native bundle.

## Files added by this feature

| File | Purpose |
|---|---|
| `capacitor.config.json` | Capacitor project config (webDir, appId, server URL, allowlist) |
| `package.json`          | npm scripts for `cap add/sync/run/open` |
| `capacitor/README.md`   | This file |

## Store-listing checklist (before publishing)

* [ ] Replace the default splash / icon in `android/app/src/main/res/` and
  `ios/App/App/Assets.xcassets/`.
* [ ] Update `appId` / bundle identifier if you plan to publish under a
  different domain.
* [ ] Add a privacy policy URL to `AndroidManifest.xml` and Info.plist.
* [ ] Set `versionCode` / `versionName` in the Gradle file and bump
  `CFBundleShortVersionString` in Info.plist between releases.
