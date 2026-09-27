# Google Play Store — Release Checklist for All For Pets

Everything you need to publish `com.allforpets.municipal` to the Play Store.

---

## 1. One-time setup

### 1.1 Create a release keystore

Do this **once**. Back up the resulting `.jks` file to a password manager or
secure vault — if you lose it you can never update the app again on Play.

From the `android/` folder in an elevated PowerShell:

```powershell
# Replace <JDK_PATH> with your JDK 17 install, e.g. C:\Program Files\Java\jdk-17
& "<JDK_PATH>\bin\keytool.exe" -genkeypair `
    -v `
    -keystore afp-release.jks `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -alias afp-release
```

You will be prompted for:

- Keystore password  → remember it, goes into `keystore.properties`
- Key password       → can be the same as keystore password
- Name / OU / Org / City / State / Country → free text (used on the certificate)

Result: `android/afp-release.jks` (git-ignored).

### 1.2 Wire the keystore into gradle

```powershell
copy android\keystore.properties.example android\keystore.properties
notepad android\keystore.properties     # fill in the real passwords
```

`android/app/build.gradle` already reads this file, and both files are in
`.gitignore`, so credentials never leave your machine.

### 1.3 Bump the version for each Play Store upload

Play will **reject** an upload with the same `versionCode` as the previous one.
Edit `android/app/build.gradle`:

```gradle
defaultConfig {
    versionCode 2          // integer — increment by 1 each release
    versionName "1.0.1"    // user-visible string
}
```

---

## 2. Build the App Bundle

From the repo root:

```powershell
cd android
.\build-release-aab.ps1
```

The script:

1. Runs `npx cap sync android` so Capacitor copies the latest web assets in.
2. Runs `gradlew clean :app:bundleRelease`.
3. Prints the location and size of the signed `.aab`.

Output: `android/app/build/outputs/bundle/release/app-release.aab`

> ℹ️ Play Store requires **`.aab`** for new apps since Aug 2021 — **not** `.apk`.

---

## 3. Play Console — first-time submission

1. Sign up at <https://play.google.com/console> (one-time USD 25 fee).
2. **Create app** → name `All For Pets`, default lang English, Free.
3. Follow the "Set up your app" tasks in the left rail. The mandatory ones:

| Section | What to say |
|---|---|
| Privacy policy | URL to a hosted page (see §4 below) |
| App access | "All features available without special access" (unless you gate the admin routes at the app level) |
| Ads | No |
| Content rating | Fill the IARC questionnaire (utility app, no violence/gambling) |
| Target audience | 13+ |
| News app | No |
| Data safety | Declare what you collect: name, mobile, email, address, pet photos, precise location if you use it. Sharing: none. Encrypted in transit: yes. |
| Government app | Yes (if applicable to your municipality partnership) |

4. **Production** → **Create new release** → upload `app-release.aab`.
5. On the same page, paste release notes (e.g. "Initial release — pet licence registration, renewal, vaccine reminders, vet & shop directory.").
6. **Main store listing** → see §4.
7. **Send for review**.  Approval usually takes 1–7 days for a first submission.

---

## 4. Store listing assets

Prepare these before you start filling in the console (all can be dropped in
under `android/play-store-assets/` in this repo for future reference).

| Asset | Size / format | Notes |
|---|---|---|
| App icon | 512×512 PNG, ≤ 1 MB | Use `resources/icon.png` scaled up |
| Feature graphic | 1024×500 PNG | Colourful banner shown atop the listing |
| Phone screenshots | Min 2, max 8. 9:16 aspect, PNG/JPG, 320–3840 px on shortest side | Take from a Pixel emulator |
| Short description | ≤ 80 chars | e.g. "Municipal pet licence, vet finder & vaccine reminders." |
| Full description | ≤ 4000 chars | Feature bullets + benefits |
| Privacy policy URL | Live HTTPS page | Add a `/PrivacyPolicy` Razor page hosting the policy |
| Support email | required | e.g. support@allforpets.example |

Draft **full description** you can paste in:

> **All For Pets** is the official municipal pet-registration companion for
> citizens of participating Nagar Nigams.
>
> • Register your pet's licence in minutes and pay online.
> • Renew licences before they expire and get an in-app reminder.
> • Track vaccination due dates so your pet is always up to date.
> • Find nearby vets and pet-food shops, read reviews, rate your visit.
> • Report stray, lost or unlicensed animals to your ward officer.
> • Ward officers, Nigam admins and city admins have their own secure portal
>   for approvals, billing and audit.
>
> No ads. No trackers. Data stays with your city government.

---

## 5. Things to double-check before you hit **Send for review**

- [ ] `versionCode` bumped and matches what's in the `.aab` file name.
- [ ] Signing report inside Play Console shows the same SHA-1 fingerprint as
      your local keystore (Play → App integrity → App signing).
- [ ] Deep links open the right page in-app. Check
      `android/app/src/main/AndroidManifest.xml` intent filters.
- [ ] Backend `API_BASE` in the built assets points at Railway prod
      (`https://afp.up.railway.app`) — not `localhost`.
- [ ] Camera & storage permissions requested only when user taps
      "Upload photo" (Capacitor does this correctly out of the box).
- [ ] Privacy policy page is live and reachable over HTTPS.
- [ ] Support email address inbox is monitored.

---

## 6. After the app is live

- **Internal / Closed / Open testing tracks** — great for shipping to a
  handful of ward officers before hitting Production. Same `.aab`, just
  different track.
- **Play App Signing** — Google re-signs your `.aab` with their own key. Keep
  your local upload key safe; if you lose it Google can help reset the
  upload key without republishing.
- **In-app updates** — later you can wire the Capacitor
  `@capacitor-community/in-app-review` and Play In-App Updates library so
  users get prompted to update without leaving the app.

---

Questions? See:
- <https://developer.android.com/studio/publish>
- <https://capacitorjs.com/docs/android/deploying-to-google-play>
