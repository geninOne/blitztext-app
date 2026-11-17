#!/usr/bin/env bash
# Prueft, dass alle Versionsnummern im Repo exakt zum Release-Tag passen und
# dass beide oeffentlichen Update-Schluessel hinterlegt sind.
# Nutzung: scripts/check-release-version.sh v1.6.0
set -euo pipefail

TAG="${1:?Tag erwartet, zum Beispiel v1.6.0}"
EXPECTED="${TAG#v}"

if ! [[ "$EXPECTED" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Tag '$TAG' ist kein dreistelliges Semver. Erwartet wird vX.Y.Z." >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

mac_version="$(sed -n 's/^ *MARKETING_VERSION: *"\{0,1\}\([0-9.]*\)"\{0,1\} *$/\1/p' BlitztextMac/project.yml | head -1)"
win_package="$(node -p "require('./BlitztextWin/package.json').version")"
win_tauri="$(node -p "require('./BlitztextWin/src-tauri/tauri.conf.json').version")"
win_cargo="$(sed -n 's/^version = "\([0-9][0-9.]*\)".*/\1/p' BlitztextWin/src-tauri/Cargo.toml | head -1)"
# Die Lock-Datei traegt die Version des eigenen Pakets mit. Wird sie beim
# Versionssprung vergessen, laeuft der Windows-Build zwar durch, schreibt aber
# die Lock-Datei still um. Der CI-Job faengt das mit --locked ab, hier steht
# es dann gleich mit Dateinamen dabei.
win_cargo_lock="$(awk '/^name = "blitztextwin"$/ {getline; gsub(/[^0-9.]/, "", $0); print; exit}' BlitztextWin/src-tauri/Cargo.lock)"

status=0
check() {
    local datei="$1"
    local wert="$2"
    if [ "$wert" != "$EXPECTED" ]; then
        echo "$datei steht auf '$wert', erwartet wird '$EXPECTED'." >&2
        status=1
    fi
}

check "BlitztextMac/project.yml (MARKETING_VERSION)" "$mac_version"
check "BlitztextWin/package.json (version)" "$win_package"
check "BlitztextWin/src-tauri/tauri.conf.json (version)" "$win_tauri"
check "BlitztextWin/src-tauri/Cargo.toml (version)" "$win_cargo"
check "BlitztextWin/src-tauri/Cargo.lock (blitztextwin)" "$win_cargo_lock"

# Ohne oeffentlichen Schluessel lehnt jeder Client das Update ab. Das faellt
# erst beim Nutzer auf, deshalb gehoert es hierher.
check_schluessel() {
    local datei="$1"
    local wert="$2"
    if [ -z "$wert" ]; then
        echo "$datei ist leer. Ohne oeffentlichen Schluessel lehnt jede Installation das Update ab." >&2
        status=1
    fi
}

# Der Mac aktualisiert sich seit dem Upstream-Sync ueber Sparkle. Info.plist
# zieht beide Werte aus project.yml, deshalb wird dort gelesen.
mac_pubkey="$(sed -n 's/^ *SPARKLE_PUBLIC_ED_KEY: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' BlitztextMac/project.yml | head -1)"
mac_feed="$(sed -n 's/^ *SPARKLE_FEED_URL: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' BlitztextMac/project.yml | head -1)"
win_pubkey="$(node -p "(require('./BlitztextWin/src-tauri/tauri.conf.json').plugins?.updater?.pubkey || '').trim()")"

check_schluessel "BlitztextMac/project.yml (SPARKLE_PUBLIC_ED_KEY)" "$mac_pubkey"
check_schluessel "BlitztextWin/src-tauri/tauri.conf.json (plugins.updater.pubkey)" "$win_pubkey"

# Der Feed muss auf dieses Repository zeigen. Stuende hier noch die Adresse des
# Originalprojekts, wuerde jede Installation beim naechsten Update auf dessen
# Version wechseln und unsere Ergaenzungen verlieren.
case "$mac_feed" in
    https://github.com/geninOne/blitztext-app/*)
        ;;
    "")
        echo "BlitztextMac/project.yml (SPARKLE_FEED_URL) ist leer." >&2
        status=1
        ;;
    *)
        echo "BlitztextMac/project.yml (SPARKLE_FEED_URL) zeigt auf '$mac_feed' statt auf dieses Repository." >&2
        status=1
        ;;
esac

if [ "$status" -eq 0 ]; then
    echo "Alle Versionsnummern stimmen mit $TAG ueberein, beide Update-Schluessel sind hinterlegt, der Sparkle-Feed zeigt auf dieses Repository."
fi
exit "$status"
