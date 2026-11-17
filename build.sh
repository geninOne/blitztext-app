#!/bin/bash
set -euo pipefail

# Blitztext macOS App - Build & Run
# Voraussetzungen: Xcode Command Line Tools, xcodegen

RUN_AFTER=false
INSTALL_APP=false
# Fork: nur die Architektur dieses Rechners bauen, ohne clean. Fuer die
# Kompilierpruefung in der CI, nicht fuer Auslieferung.
FAST_BUILD=false
BUILD_CONFIGURATION="Release"
UNIVERSAL_ARCHS="arm64 x86_64"
# Signing identity for the finished app. Default "-" is ad hoc: works on this Mac, but
# macOS treats every rebuild as a new app and asks for the Accessibility permission again.
# Set CODESIGN_IDENTITY to a certificate from `security find-identity -v -p codesigning`,
# e.g. "Apple Development: Name (TEAMID)" from a free Apple ID in Xcode, and the
# permission survives rebuilds. The app needs no provisioning profile for that.
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:--}"

for arg in "$@"; do
    case "$arg" in
        --debug)
            BUILD_CONFIGURATION="Debug"
            ;;
        --run)
            RUN_AFTER=true
            ;;
        --install)
            INSTALL_APP=true
            ;;
        --release)
            BUILD_CONFIGURATION="Release"
            ;;
        --fast)
            FAST_BUILD=true
            ;;
        *)
            echo "Unbekannte Option: $arg"
            echo "Verwendung: ./build.sh [--install] [--run] [--release] [--debug] [--fast]"
            exit 1
            ;;
    esac
done

if [ "$FAST_BUILD" = true ]; then
    BUILD_ARCHS="$(uname -m)"
    XCODEBUILD_ACTIONS=(build)
else
    BUILD_ARCHS="$UNIVERSAL_ARCHS"
    XCODEBUILD_ACTIONS=(clean build)
fi

if [ "$FAST_BUILD" = true ] && [ "$INSTALL_APP" = true ]; then
    echo "❌ --fast und --install passen nicht zusammen."
    echo "   Ein --fast-Build laeuft nur auf $BUILD_ARCHS und ist nicht universal."
    exit 1
fi

verify_universal_app() {
    local app_path="$1"
    local app_name
    local binary_path
    local archs

    # Der Name des Binaries steht in der Info.plist. Aus dem Ordnernamen
    # abgeleitet stimmt er nur, solange der Ordner "Blitztext.app" heisst,
    # und waehrend der Installation heisst er voruebergehend anders.
    app_name="$(/usr/libexec/PlistBuddy -c "Print CFBundleExecutable" "$app_path/Contents/Info.plist" 2>/dev/null || true)"
    if [ -z "$app_name" ]; then
        app_name="$(basename "$app_path" .app)"
    fi
    binary_path="$app_path/Contents/MacOS/$app_name"

    if [ ! -f "$binary_path" ]; then
        echo "❌ Konnte App-Binary nicht finden: $binary_path"
        exit 1
    fi

    archs="$(lipo -archs "$binary_path" 2>/dev/null || true)"

    if [[ -z "$archs" ]]; then
        echo "❌ Konnte Architekturen nicht lesen: $binary_path"
        file "$binary_path" 2>/dev/null || true
        exit 1
    fi

    local expected
    for expected in $BUILD_ARCHS; do
        if [[ " $archs " != *" $expected "* ]]; then
            echo "❌ Build enthaelt $expected nicht. Erwartet: $BUILD_ARCHS"
            echo "   Gefunden: $archs"
            file "$binary_path" 2>/dev/null || true
            exit 1
        fi
    done

    echo "✅ Architekturen verifiziert: $archs"
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/BlitztextMac"
PROJECT_FILE="$PROJECT_DIR/BlitztextMac.xcodeproj"
# Keep DerivedData outside iCloud-synced folders (Desktop/Documents): the file
# provider adds com.apple.FinderInfo xattrs to bundles, which breaks codesign with
# "resource fork, Finder information, or similar detritus not allowed".
# (cmagnussen/blitztext-app PR #5)
DERIVED_DATA_PATH="$HOME/Library/Caches/blitztext-build/derivedData"
cd "$PROJECT_DIR"

if command -v xcodegen &> /dev/null; then
    echo "⚙️  Generiere Xcode-Projekt ..."
    xcodegen generate 2>&1
elif [ -d "$PROJECT_FILE" ]; then
    echo "⚠️  xcodegen nicht gefunden – nutze vorhandenes Xcode-Projekt."
elif command -v brew &> /dev/null; then
    echo "📦 Installiere xcodegen ..."
    brew install xcodegen
    echo "⚙️  Generiere Xcode-Projekt ..."
    xcodegen generate 2>&1
else
    echo "❌ xcodegen fehlt und Homebrew ist nicht installiert."
    echo "   Installiere xcodegen oder stelle sicher, dass $PROJECT_FILE vorhanden ist."
    exit 1
fi

# Bauen
echo "🔨 Baue Blitztext ..."
xcodebuild \
    -project BlitztextMac.xcodeproj \
    -scheme BlitztextMac \
    -destination 'platform=macOS' \
    -configuration "$BUILD_CONFIGURATION" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    ONLY_ACTIVE_ARCH=NO \
    ARCHS="$BUILD_ARCHS" \
    "${XCODEBUILD_ACTIONS[@]}"

# App finden
APP_PATH="$DERIVED_DATA_PATH/Build/Products/$BUILD_CONFIGURATION/Blitztext.app"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Build fehlgeschlagen – keine App gefunden."
    exit 1
fi

verify_universal_app "$APP_PATH"

# Resources manuell ins Bundle kopieren (xcodegen kopiert sie nicht automatisch)
echo "📋 Kopiere Resources ..."
RESOURCES_DIR="$APP_PATH/Contents/Resources"
mkdir -p "$RESOURCES_DIR"
cp -f "$PROJECT_DIR/Resources/AppIcon.icns" "$RESOURCES_DIR/" 2>/dev/null || true
cp -f "$PROJECT_DIR/Resources/menubar_icon.png" "$RESOURCES_DIR/" 2>/dev/null || true
cp -f "$PROJECT_DIR/Resources/menubar_icon@2x.png" "$RESOURCES_DIR/" 2>/dev/null || true

# Ziel vorab bestimmen: nur einmal kopieren, signieren und pruefen, ohne zweite Kopie
# im Projektordner (cmagnussen/blitztext-app PR #16).
if [ "$INSTALL_APP" = true ]; then
    APPS_DIR="/Applications"
    DEST="$APPS_DIR/Blitztext.app"
    if [ ! -w "$APPS_DIR" ]; then
        echo "❌ /Applications ist nicht beschreibbar."
        echo "   Fuehre den Befehl mit passenden Rechten erneut aus oder ziehe die App manuell nach /Applications."
        exit 1
    fi
else
    DEST="$SCRIPT_DIR/Blitztext.app"
fi

# >>> installationsblock (scripts/test-install-block.sh schneidet ihn hier heraus)
# Signiert und geprueft wird in einer Nebenablage, getauscht wird erst danach.
# Vorher wurde direkt am Ziel gearbeitet: schlug das Signieren fehl, lag in
# /Applications eine App mit kaputter Signatur, die macOS nicht mehr startet,
# und die vorige, funktionierende Fassung war da schon geloescht.
STAGING="$(dirname "$DEST")/.$(basename "$DEST").neu-$$"
BACKUP="$(dirname "$DEST")/.$(basename "$DEST").vorher-$$"

aufraeumen() {
    rm -rf "$STAGING"
    # Der Tausch ist abgebrochen, waehrend das Ziel schon zur Seite lag:
    # lieber die vorige Fassung zurueckholen als gar keine App.
    if [ -d "$BACKUP" ] && [ ! -d "$DEST" ]; then
        mv "$BACKUP" "$DEST"
    fi
    rm -rf "$BACKUP"
}
trap aufraeumen EXIT

rm -rf "$STAGING"
cp -R "$APP_PATH" "$STAGING"
# iCloud or the file provider may have added xattrs again; codesign refuses them.
xattr -cr "$STAGING" 2>/dev/null || true
signier_status=0
if [ "$CODESIGN_IDENTITY" = "-" ]; then
    echo "🔏 Signiere ad hoc (CODESIGN_IDENTITY nicht gesetzt) ..."
    signier_ausgabe="$(codesign --force --deep --sign - "$STAGING" 2>&1)" || signier_status=$?
else
    # Keep the entitlements Xcode gave each binary (microphone, network); the
    # app entitlements must not be pushed onto Sparkle's XPC services.
    signier_optionen=(--force --deep --timestamp=none)

    # Die Team-ID steht als OU im Zertifikat. Ein selbst erzeugtes Zertifikat
    # hat keine, und dann scheitert die App beim Start: mit Hardened Runtime
    # verlangt macOS, dass eingebettete Frameworks dieselbe Team-ID haben wie
    # der Prozess, und zwei leere Team-IDs gelten dabei nicht als gleich.
    # Sparkle laedt dann nicht ("different Team IDs"). Ad-hoc ist davon
    # ausgenommen, ein Developer-ID-Zertifikat hat eine echte Team-ID. Nur im
    # Fall ohne Team-ID wird deshalb ohne Hardened Runtime signiert.
    # Das || true ist noetig: gibt es das Zertifikat nicht, scheitert die
    # Abfrage, und mit set -e waere hier stillschweigend Schluss, statt dass
    # weiter unten die Fehlermeldung von codesign kommt.
    zertifikat_team="$(security find-certificate -c "$CODESIGN_IDENTITY" -p 2>/dev/null \
        | openssl x509 -noout -subject 2>/dev/null \
        | sed -n 's/.*OU[ ]*=[ ]*\([^,/]*\).*/\1/p')" || true
    if [ -n "$zertifikat_team" ]; then
        echo "🔏 Signiere mit: $CODESIGN_IDENTITY (Team $zertifikat_team) ..."
        signier_optionen+=(--preserve-metadata=entitlements,runtime)
    else
        echo "🔏 Signiere mit: $CODESIGN_IDENTITY ..."
        echo "   Zertifikat ohne Team-ID, daher ohne Hardened Runtime."
        echo "   Fuer eine Auslieferung ein Developer-ID-Zertifikat nehmen."
        signier_optionen+=(--preserve-metadata=entitlements)
    fi

    signier_ausgabe="$(codesign "${signier_optionen[@]}" \
        --sign "$CODESIGN_IDENTITY" "$STAGING" 2>&1)" || signier_status=$?
fi
[ -n "$signier_ausgabe" ] && echo "$signier_ausgabe"

# codesign meldet manche Fehler nur im Text, nicht im Rueckgabewert.
if [ "$signier_status" -ne 0 ] || printf '%s' "$signier_ausgabe" | grep -q "errSec"; then
    echo "❌ Signieren fehlgeschlagen."
    if printf '%s' "$signier_ausgabe" | grep -q "errSecInternalComponent"; then
        echo "   errSecInternalComponent heisst fast immer: codesign kam nicht an den"
        echo "   privaten Schluessel. Meist wartet ein Schluesselbund-Dialog auf eine"
        echo "   Bestaetigung oder wurde abgelehnt. Einmal 'Immer erlauben' klicken,"
        echo "   dann laeuft es auch ohne Rueckfrage durch."
        echo "   Hilft das nicht, den Schluesselbund-Suchpfad ansehen, dort koennen"
        echo "   geloeschte temporaere Schluesselbunde von Xcode stehen:"
        echo "     security list-keychains"
        echo "     security list-keychains -d user -s ~/Library/Keychains/login.keychain-db"
    fi
    if [ -d "$DEST" ]; then
        echo "   $DEST bleibt unveraendert."
    fi
    exit 1
fi

if ! codesign --verify --deep --strict "$STAGING" 2>&1; then
    echo "❌ Signatur ungültig."
    if [ -d "$DEST" ]; then
        echo "   $DEST bleibt unveraendert."
    fi
    exit 1
fi
echo "✅ Signatur geprüft"
verify_universal_app "$STAGING"

# Erst jetzt tauschen. Die vorige Fassung geht zur Seite, bis der Tausch steht.
if [ -d "$DEST" ]; then
    mv "$DEST" "$BACKUP"
fi
if ! mv "$STAGING" "$DEST"; then
    echo "❌ Konnte die neue App nicht nach $DEST verschieben."
    exit 1
fi
rm -rf "$BACKUP"
trap - EXIT
# <<< installationsblock

RUN_TARGET="$DEST"

echo ""
echo "✅ Fertig! App liegt unter:"
echo "   $DEST"
echo ""
echo "Build-Typ: $BUILD_CONFIGURATION"
echo "Signatur: $([ "$CODESIGN_IDENTITY" = "-" ] && echo "ad hoc" || echo "$CODESIGN_IDENTITY")"
echo "Architekturen: $BUILD_ARCHS"
if [ "$FAST_BUILD" = true ]; then
    echo "Kompatibel: nur $BUILD_ARCHS (--fast), macOS 14+"
else
    echo "Kompatibel: Apple Silicon + Intel (macOS 14+)"
fi
echo ""
echo "Naechste Schritte:"
echo "1. App starten"
echo "2. Mikrofon erlauben"
echo "3. Fuer direktes Einfuegen zusaetzlich Bedienungshilfen erlauben"
echo "4. Lokales Sprachmodell laden, optional einen Modell-Anbieter mit API-Key eintragen"
echo "5. Fertige Version: https://github.com/geninOne/blitztext-app/releases"
echo ""

# Optional: direkt starten
if [ "$RUN_AFTER" = true ]; then
    echo "🚀 Starte Blitztext ..."
    open "$RUN_TARGET"
fi
