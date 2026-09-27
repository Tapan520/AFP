# ─────────────────────────────────────────────────────────────────────────────
#  make-release-bundle.ps1
#
#  One-shot helper: creates the keystore if missing, writes keystore.properties,
#  syncs Capacitor web assets, and builds a signed .aab ready for Play Store.
#
#  Run from the repo root:
#     .\android\make-release-bundle.ps1
#
#  IMPORTANT: neither the .jks nor keystore.properties is committed to Git.
#  See android/KEYSTORE_README.txt for safe backup options.
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"

$androidDir = Join-Path $PSScriptRoot "."
$repoRoot   = Split-Path -Parent $androidDir
$jks        = Join-Path $androidDir "afp-release.jks"
$props      = Join-Path $androidDir "keystore.properties"
$outBundle  = Join-Path $androidDir "app\build\outputs\bundle\release\app-release.aab"

function Find-Keytool {
    # Prefer JAVA_HOME, then PATH, then common Windows install locations.
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\keytool.exe"))) {
        return Join-Path $env:JAVA_HOME "bin\keytool.exe"
    }
    $onPath = Get-Command keytool -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $candidates = Get-ChildItem "C:\Program Files\Java" -Directory -ErrorAction SilentlyContinue |
                  ForEach-Object { Join-Path $_.FullName "bin\keytool.exe" } |
                  Where-Object { Test-Path $_ }
    if ($candidates.Count -gt 0) { return $candidates[0] }
    return $null
}

Write-Host ""
Write-Host "=== All For Pets - Play Store bundle builder ===" -ForegroundColor Cyan
Write-Host ""

# 1. Ensure keystore exists ────────────────────────────────────────────────
if (-not (Test-Path $jks)) {
    Write-Host "No keystore found. Creating a new one..." -ForegroundColor Yellow
    $keytool = Find-Keytool
    if (-not $keytool) {
        Write-Host "ERROR: keytool.exe not found. Install JDK 17 and re-run." -ForegroundColor Red
        Write-Host "       Download: https://adoptium.net/temurin/releases/?version=17" -ForegroundColor Red
        exit 1
    }
    Write-Host "Using keytool: $keytool" -ForegroundColor DarkGray

    $storePass = Read-Host "Set a keystore password (min 6 chars, remember this!)" -AsSecureString
    $storePlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePass))
    if ($storePlain.Length -lt 6) { Write-Host "ERROR: password too short."; exit 1 }

    $dname = Read-Host "Certificate name (e.g. 'All For Pets Municipal')"
    if ([string]::IsNullOrWhiteSpace($dname)) { $dname = "All For Pets" }

    Write-Host "Generating afp-release.jks (10000-day validity)..." -ForegroundColor Cyan
    & $keytool -genkeypair -v `
        -keystore $jks `
        -alias afp-release `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $storePlain -keypass $storePlain `
        -dname "CN=$dname, OU=Mobile, O=All For Pets, L=Jaipur, ST=RJ, C=IN"

    if (-not (Test-Path $jks)) { Write-Host "ERROR: keystore not created."; exit 1 }
    Write-Host ""
    Write-Host "Keystore created at $jks" -ForegroundColor Green
    Write-Host "!!  BACK THIS FILE UP NOW  !!" -ForegroundColor Yellow
    Write-Host "!!  Losing it = you can never update the app on Play Store." -ForegroundColor Yellow
    Write-Host ""

    # Write keystore.properties
    @"
storeFile=afp-release.jks
storePassword=$storePlain
keyAlias=afp-release
keyPassword=$storePlain
"@ | Set-Content -Encoding ASCII $props
    Write-Host "Wrote $props" -ForegroundColor Green
} else {
    Write-Host "Reusing existing keystore: $jks" -ForegroundColor Green
    if (-not (Test-Path $props)) {
        Write-Host "ERROR: keystore.properties missing next to the keystore." -ForegroundColor Red
        Write-Host "       Copy android/keystore.properties.example and fill it in." -ForegroundColor Red
        exit 1
    }
}

# 2. Sync Capacitor assets ─────────────────────────────────────────────────
Write-Host ""
Write-Host "==> Syncing web assets (npx cap sync android)..." -ForegroundColor Cyan
Push-Location $repoRoot
try { npx --yes cap sync android } finally { Pop-Location }

# 3. Gradle release bundle ────────────────────────────────────────────────
Write-Host ""
Write-Host "==> Running gradle bundleRelease..." -ForegroundColor Cyan
Push-Location $androidDir
try { .\gradlew.bat --no-daemon clean :app:bundleRelease } finally { Pop-Location }

# 4. Report ────────────────────────────────────────────────────────────────
if (Test-Path $outBundle) {
    $size = "{0:N2} MB" -f ((Get-Item $outBundle).Length / 1MB)
    Write-Host ""
    Write-Host "SUCCESS." -ForegroundColor Green
    Write-Host "  Bundle : $outBundle"
    Write-Host "  Size   : $size"
    Write-Host ""
    Write-Host "Upload this file at:" -ForegroundColor Cyan
    Write-Host "  https://play.google.com/console -> your app -> Production -> Create new release"
} else {
    Write-Host "ERROR: build finished but bundle not found at $outBundle" -ForegroundColor Red
    exit 1
}
