#!/bin/bash
set -euo pipefail

# Blitztext macOS App - Build & Run
# Voraussetzungen: Full Xcode with Command Line Tools, xcodegen

RUN_AFTER=false
INSTALL_APP=false
FAST_BUILD=false
BUILD_CONFIGURATION="Release"
UNIVERSAL_ARCHS="arm64 x86_64"

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
            # Nur die Architektur des Rechners, kein clean. Fuer schnelle
            # Kompilierpruefungen wie in der CI, nicht fuer Auslieferung.
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

verify_app_archs() {
    local app_path="$1"
    local app_name
    local binary_path
    local archs

    app_name="$(basename "$app_path" .app)"
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

ensure_xcodebuild_available() {
    if xcodebuild -version >/dev/null 2>&1; then
        return
    fi

    local default_xcode="/Applications/Xcode.app/Contents/Developer"
    if [ -d "$default_xcode" ]; then
        export DEVELOPER_DIR="$default_xcode"
        if xcodebuild -version >/dev/null 2>&1; then
            echo "⚠️  Aktiver Developer-Pfad nutzt kein vollständiges Xcode. Verwende: $DEVELOPER_DIR"
            return
        fi
    fi

    echo "❌ xcodebuild ist nicht verfügbar."
    echo "   Installiere Xcode und wähle es mit:"
    echo "   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    exit 1
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/BlitztextMac"
PROJECT_FILE="$PROJECT_DIR/BlitztextMac.xcodeproj"
DERIVED_DATA_PATH="$SCRIPT_DIR/.derivedData-blitztextmac-build"
cd "$PROJECT_DIR"

ensure_xcodebuild_available

if command -v xcodegen &> /dev/null; then
    echo "⚙️  Generiere Xcode-Projekt ..."
    xcodegen generate 2>&1
elif [ -d "$PROJECT_FILE" ]; then
    echo "⚠️  xcodegen nicht gefunden – nutze vorhandenes Xcode-Projekt."
else
    echo "❌ xcodegen fehlt."
    echo "   Installiere xcodegen explizit mit:"
    echo "   brew install xcodegen"
    echo "   Oder stelle sicher, dass $PROJECT_FILE vorhanden ist."
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

verify_app_archs "$APP_PATH"

# Resources manuell ins Bundle kopieren (xcodegen kopiert sie nicht automatisch)
echo "📋 Kopiere Resources ..."
RESOURCES_DIR="$APP_PATH/Contents/Resources"
mkdir -p "$RESOURCES_DIR"
cp -f "$PROJECT_DIR/Resources/AppIcon.icns" "$RESOURCES_DIR/" 2>/dev/null || true
cp -f "$PROJECT_DIR/Resources/menubar_icon.png" "$RESOURCES_DIR/" 2>/dev/null || true
cp -f "$PROJECT_DIR/Resources/menubar_icon@2x.png" "$RESOURCES_DIR/" 2>/dev/null || true

# In Projektordner kopieren
DEST="$SCRIPT_DIR/Blitztext.app"
rm -rf "$DEST"
cp -R "$APP_PATH" "$DEST"
echo "🔏 Signiere lokale Development-App ad-hoc. Dieses Artefakt ist nicht notarisiert."
codesign --force --sign - "$DEST" 2>&1
verify_app_archs "$DEST"

RUN_TARGET="$DEST"

if [ "$INSTALL_APP" = true ]; then
    APPS_DIR="/Applications"
    INSTALL_DEST="$APPS_DIR/Blitztext.app"
    if [ ! -w "$APPS_DIR" ]; then
        echo "❌ /Applications ist nicht beschreibbar."
        echo "   Fuehre den Befehl mit passenden Rechten erneut aus oder ziehe die App manuell nach /Applications."
        exit 1
    fi
    rm -rf "$INSTALL_DEST"
    cp -R "$DEST" "$INSTALL_DEST"
    echo "🔏 Signiere lokale Development-App ad-hoc. Dieses Artefakt ist nicht notarisiert."
    codesign --force --sign - "$INSTALL_DEST" 2>&1
    verify_app_archs "$INSTALL_DEST"
    RUN_TARGET="$INSTALL_DEST"
fi

echo ""
echo "✅ Fertig! App liegt unter:"
echo "   $DEST"
if [ "$INSTALL_APP" = true ]; then
    echo "   $RUN_TARGET"
fi
echo ""
echo "Build-Typ: $BUILD_CONFIGURATION"
echo "Architekturen: $BUILD_ARCHS"
if [ "$FAST_BUILD" = true ]; then
    echo "Kompatibel: nur dieser Rechner. Fuer Auslieferung ohne --fast bauen."
else
    echo "Kompatibel: Apple Silicon + Intel (macOS 14+)"
fi
echo ""
echo "Naechste Schritte:"
echo "1. App starten"
echo "2. Mikrofon erlauben"
echo "3. Fuer direktes Einfuegen zusaetzlich Bedienungshilfen erlauben"
echo "4. In Blitztext deinen eigenen OpenAI API Key eintragen"
echo "5. Loslegen und bei Bedarf im Code weiterbauen"
echo ""

# Optional: direkt starten
if [ "$RUN_AFTER" = true ]; then
    echo "🚀 Starte Blitztext ..."
    open "$RUN_TARGET"
fi
