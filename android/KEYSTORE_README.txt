# This directory is intentionally NOT tracked in Git.
#
# It holds:
#   - afp-release.jks           (Android upload keystore)
#   - keystore.properties       (passwords)
#
# NEVER commit either file. The upload keystore is the single most
# sensitive secret in an Android app — leaking it lets attackers push
# malicious updates to real users on the Play Store.
#
# Safe places to back it up:
#   1. Google Play App Signing (Play Console -> App integrity)
#   2. A password manager attachment (1Password / Bitwarden)
#   3. An encrypted GitHub Actions secret (see .github/workflows/android-release.yml)
#   4. Two offline USB sticks stored in different locations
#
# See android/PLAY_STORE_CHECKLIST.md for the full procedure.
