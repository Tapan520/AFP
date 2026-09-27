# ─────────────────────────────────────────────────────────────────────────────
#  build-release-aab.ps1
#  Builds a signed .aab (Android App Bundle) ready for Google Play upload.
#
#  Prerequisites (one-time, see PLAY_STORE_CHECKLIST.md for full details):
#    1. JDK 17 on PATH  (`java -version` should show 17.x)
#    2. Android SDK installed; ANDROID_HOME or ANDROID_SDK_ROOT env var set.
#    3. A release keystore file, e.g. android/afp-release.jks
#    4. android/keystore.properties populated (see PLAY_STORE_CHECKLIST.md).
#
#  Usage (from repo root):
#     cd android
#     .\build-release-aab.ps1
#
#  Output:
#     android/app/build/outputs/bundle/release/app-release.aab
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"

$root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Split-Path -Parent $root
$propsFile  = Join-Path $root "keystore.properties"
$outBundle  = Join-Path $root "app\build\outputs\bundle\release\app-release.aab"

Write-Host ""
Write-Host "==> All For Pets: Play Store release build" -ForegroundColor Cyan
Write-Host ""

# 1. Sanity checks
if (-not (Test-Path $propsFile)) {
    Write-Host "ERROR: android/keystore.properties not found." -ForegroundColor Red
    Write-Host "       Copy android/keystore.properties.example and fill it in first." -ForegroundColor Red
    exit 1
}
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
    Write-Host "WARNING: ANDROID_HOME / ANDROID_SDK_ROOT not set. Gradle may fail." -ForegroundColor Yellow
}

# 2. Refresh Capacitor web assets (index.html, JS, css) inside the Android project.
Write-Host "==> Syncing Capacitor web assets..." -ForegroundColor Cyan
Push-Location $repoRoot
try {
    npx --yes cap sync android
} finally {
    Pop-Location
}

# 3. Gradle release bundle
Write-Host ""
Write-Host "==> Running gradle bundleRelease..." -ForegroundColor Cyan
Push-Location $root
try {
    .\gradlew.bat --no-daemon clean :app:bundleRelease
} finally {
    Pop-Location
}

# 4. Report
if (Test-Path $outBundle) {
    $size = "{0:N2} MB" -f ((Get-Item $outBundle).Length / 1MB)
    Write-Host ""
    Write-Host "Build OK." -ForegroundColor Green
    Write-Host "  Bundle : $outBundle"
    Write-Host "  Size   : $size"
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Open https://play.google.com/console/"
    Write-Host "  2. Create app -> Production -> Create new release -> Upload the .aab above."
    Write-Host "  3. See android/PLAY_STORE_CHECKLIST.md for listing content."
} else {
    Write-Host "ERROR: build finished but bundle not found at $outBundle" -ForegroundColor Red
    exit 1
}
