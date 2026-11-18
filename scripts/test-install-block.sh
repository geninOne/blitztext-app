#!/usr/bin/env bash
# Prueft den Installationsblock aus build.sh, ohne die ganze App zu bauen.
#
# Der Block kopiert die fertige App in eine Nebenablage, signiert und prueft
# sie dort und tauscht erst danach. Schlaegt etwas fehl, muss die vorige,
# funktionierende Installation unangetastet bleiben. Genau das wird hier
# gegen ein winziges Fake-Bundle durchgespielt.
#
# Nutzung: scripts/test-install-block.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_SH="$REPO_ROOT/build.sh"
ARCH="$(uname -m)"

ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

# Block und Prueffunktion aus build.sh herausschneiden, damit der Test den
# echten Code laufen laesst und nicht eine Kopie, die veraltet.
awk '/^# >>> installationsblock/{p=1; next} /^# <<< installationsblock/{p=0} p' \
    "$BUILD_SH" > "$ARBEIT/block.sh"
awk '/^verify_universal_app\(\) \{/{p=1} p{print} /^\}/{if (p) exit}' \
    "$BUILD_SH" > "$ARBEIT/verify.sh"

if [ ! -s "$ARBEIT/block.sh" ] || [ ! -s "$ARBEIT/verify.sh" ]; then
    echo "❌ Konnte Installationsblock oder Prueffunktion nicht aus build.sh lesen."
    echo "   Stehen die Markierungen '# >>> installationsblock' und"
    echo "   '# <<< installationsblock' noch dort?"
    exit 1
fi

fehler=0

pruefe() {
    local bedingung="$1"
    local text="$2"
    if [ "$bedingung" = "ja" ]; then
        echo "  OK   $text"
    else
        echo "  FEHL $text"
        fehler=1
    fi
}

# Ein minimales .app-Bundle. Das Binary wird uebersetzt statt kopiert: ein
# System-Binary wie /bin/echo ist arm64e, geprueft wird aber gegen arm64.
fake_app() {
    local ziel="$1"
    local kennung="$2"
    mkdir -p "$ziel/Contents/MacOS" "$ziel/Contents/Resources"
    echo 'int main(void){return 0;}' \
        | clang -arch "$ARCH" -x c - -o "$ziel/Contents/MacOS/Blitztext"
    cat > "$ziel/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Blitztext</string>
<key>CFBundleIdentifier</key><string>app.blitztext.test</string>
</dict></plist>
PLIST
    # In Resources, nicht direkt in Contents: dort behandelt codesign eine
    # fremde Datei als unsigniertes Unterobjekt und bricht ab.
    echo "$kennung" > "$ziel/Contents/Resources/KENNUNG.txt"
}

# Einen Durchlauf des Blocks starten. Gibt den Exit-Code zurueck.
lauf() {
    local fall="$1"
    local identitaet="$2"
    local basis="$ARBEIT/$fall"
    mkdir -p "$basis"
    fake_app "$basis/build/Blitztext.app" "NEU"
    fake_app "$basis/dest/Blitztext.app" "ALT"

    {
        echo '#!/usr/bin/env bash'
        echo 'set -euo pipefail'
        echo "BUILD_ARCHS=\"$ARCH\""
        cat "$ARBEIT/verify.sh"
        echo "APP_PATH=\"$basis/build/Blitztext.app\""
        echo "DEST=\"$basis/dest/Blitztext.app\""
        echo "CODESIGN_IDENTITY=\"$identitaet\""
        cat "$ARBEIT/block.sh"
    } > "$basis/harness.sh"

    set +e
    bash "$basis/harness.sh" > "$basis/ausgabe.txt" 2>&1
    local status=$?
    set -e
    sed 's/^/    | /' "$basis/ausgabe.txt"
    return $status
}

# Reste der Nebenablagen zaehlen: nach jedem Durchlauf darf keine uebrig sein.
reste() {
    local fall="$1"
    find "$ARBEIT/$fall/dest" -maxdepth 1 -name '.Blitztext*' | wc -l | tr -d ' '
}

kennung() {
    local fall="$1"
    cat "$ARBEIT/$fall/dest/Blitztext.app/Contents/Resources/KENNUNG.txt" 2>/dev/null || echo "(fehlt)"
}

echo "Test 1: Signieren schlaegt fehl"
if lauf fehlerfall "Zertifikat Gibt Es Nicht"; then
    pruefe nein "Skript bricht mit Fehlercode ab"
else
    pruefe ja "Skript bricht mit Fehlercode ab"
fi
[ -d "$ARBEIT/fehlerfall/dest/Blitztext.app" ] && pruefe ja "Zielapp existiert weiterhin" \
    || pruefe nein "Zielapp existiert weiterhin"
[ "$(kennung fehlerfall)" = "ALT" ] && pruefe ja "Zielapp ist unveraendert die alte Fassung" \
    || pruefe nein "Zielapp ist unveraendert die alte Fassung"
[ "$(reste fehlerfall)" = "0" ] && pruefe ja "keine Nebenablage uebrig" \
    || pruefe nein "keine Nebenablage uebrig"
grep -q "bleibt unveraendert" "$ARBEIT/fehlerfall/ausgabe.txt" \
    && pruefe ja "sagt, dass das Ziel unangetastet bleibt" \
    || pruefe nein "sagt, dass das Ziel unangetastet bleibt"

echo
echo "Test 2: Signieren klappt (ad hoc)"
if lauf erfolgsfall "-"; then
    pruefe ja "Skript laeuft durch"
else
    pruefe nein "Skript laeuft durch"
fi
[ "$(kennung erfolgsfall)" = "NEU" ] && pruefe ja "Zielapp ist die neue Fassung" \
    || pruefe nein "Zielapp ist die neue Fassung"
[ "$(reste erfolgsfall)" = "0" ] && pruefe ja "keine Nebenablage uebrig" \
    || pruefe nein "keine Nebenablage uebrig"

echo
echo "Test 3: Zertifikat ohne Team-ID laesst das Hardened Runtime weg"
# Braucht ein echtes Zertifikat im Schluesselbund. Ohne eines wird der Test
# uebersprungen, damit er auf einem CI-Runner nicht rot wird.
zertifikat=""
while IFS= read -r name; do
    [ -z "$name" ] && continue
    ou="$(security find-certificate -c "$name" -p 2>/dev/null \
        | openssl x509 -noout -subject 2>/dev/null \
        | sed -n 's/.*OU[ ]*=[ ]*\([^,/]*\).*/\1/p')" || true
    if [ -z "$ou" ]; then
        zertifikat="$name"
        break
    fi
done < <(security find-identity -v -p codesigning | sed -n 's/.*"\(.*\)"/\1/p')

if [ -z "$zertifikat" ]; then
    echo "  ---  uebersprungen: kein Zertifikat ohne Team-ID im Schluesselbund"
else
    echo "  Zertifikat: $zertifikat"
    # Das Fake-Bundle bekommt vorher das Hardened Runtime, sonst gaebe es
    # nichts, das weggelassen werden koennte.
    mkdir -p "$ARBEIT/teamlos"
    fake_app "$ARBEIT/teamlos/build/Blitztext.app" "NEU"
    fake_app "$ARBEIT/teamlos/dest/Blitztext.app" "ALT"
    vorbereiten="$(codesign --force --options runtime --sign - "$ARBEIT/teamlos/build/Blitztext.app" 2>&1)" || true
    [ -n "$vorbereiten" ] && echo "    | (Vorbereitung) $vorbereiten"
    vorher="$(codesign -dvv "$ARBEIT/teamlos/build/Blitztext.app" 2>&1 | sed -n 's/.*flags=\([^ ]*\).*/\1/p')" || true

    {
        echo '#!/usr/bin/env bash'
        echo 'set -euo pipefail'
        echo "BUILD_ARCHS=\"$ARCH\""
        cat "$ARBEIT/verify.sh"
        echo "APP_PATH=\"$ARBEIT/teamlos/build/Blitztext.app\""
        echo "DEST=\"$ARBEIT/teamlos/dest/Blitztext.app\""
        echo "CODESIGN_IDENTITY=\"$zertifikat\""
        cat "$ARBEIT/block.sh"
    } > "$ARBEIT/teamlos/harness.sh"

    set +e
    bash "$ARBEIT/teamlos/harness.sh" > "$ARBEIT/teamlos/ausgabe.txt" 2>&1
    status=$?
    set -e
    sed 's/^/    | /' "$ARBEIT/teamlos/ausgabe.txt"

    nachher="$(codesign -dvv "$ARBEIT/teamlos/dest/Blitztext.app" 2>&1 | sed -n 's/.*flags=\([^ ]*\).*/\1/p')" || true
    echo "  Flags vorher: $vorher, nachher: $nachher"
    [ "$status" -eq 0 ] && pruefe ja "Skript laeuft durch" || pruefe nein "Skript laeuft durch"
    case "$vorher" in
        *runtime*) pruefe ja "Ausgangsbundle hatte das Hardened Runtime" ;;
        *) pruefe nein "Ausgangsbundle hatte das Hardened Runtime" ;;
    esac
    case "$nachher" in
        *runtime*) pruefe nein "Hardened Runtime ist weg" ;;
        *) pruefe ja "Hardened Runtime ist weg" ;;
    esac
fi

echo
if [ "$fehler" -eq 0 ]; then
    echo "✅ Installationsblock verhaelt sich wie erwartet."
else
    echo "❌ Mindestens eine Erwartung nicht erfuellt."
fi
exit "$fehler"
