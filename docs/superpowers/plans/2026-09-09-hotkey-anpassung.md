# Anpassbare Tastenkuerzel: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nutzer koennen die Tastenkuerzel aller Workflows selbst als reine Modifier-Kombinationen vergeben und einzeln oder gesammelt auf den Standard zuruecksetzen.

**Architecture:** Ein neues Wert-Modell (`HotkeyModifier`, `HotkeyCombo`, `HotkeyBindings`) haelt die Kuerzel und lebt im bestehenden Einstellungs-JSON. Ein reiner Wertetyp `HotkeyMatcher` entscheidet anhand der gehaltenen Modifier, welcher Workflow feuert, und loest Praefix-Kollisionen ueber eine kurze Wartezeit. `HotkeyService` behaelt nur noch die AppKit-Mechanik, die Einstellungen bekommen eine Aufnahmezeile pro Workflow.

**Tech Stack:** Swift 5.10, SwiftUI, AppKit (`NSEvent`-Monitore), XCTest, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-09-09-hotkey-anpassung-design.md`

## Global Constraints

- Zielplattform macOS 14.0, `SWIFT_VERSION` 5.10 (siehe `BlitztextMac/project.yml`).
- Erlaubt sind ausschliesslich reine Modifier-Kombinationen aus fn, Shift, Control, Option, Command. Keine normalen Tasten.
- Mindestens zwei Modifier pro Kombination, auch fn allein ist ungueltig.
- Doppelbelegung wird hart abgelehnt, mit Nennung des belegenden Workflows.
- Jeder Workflow behaelt immer ein Kuerzel, es gibt kein "kein Kuerzel".
- Wartezeit fuer Praefix-Kombinationen: 150 ms (`HotkeyMatcher.prefixDelay = 0.15`).
- Umlaute in Swift-Quelltext als `\u{...}`-Escapes schreiben, wie im Bestand von `SettingsContentView.swift`.
- Keine Gedankenstriche in Texten, Kommentaren und Commit-Nachrichten.
- Commit-Nachrichten im Stil des Repositories: `Update: <deutscher Satz>` mit ASCII-Umlauten (ae, oe, ue, ss).
- Tests laufen mit `./test.sh` im Projektwurzelverzeichnis, einzeln ueber `./test.sh -only-testing:BlitztextMacTests/<Klasse>`.
- Das Testziel `BlitztextMacTests` listet seine Quelldateien einzeln in `project.yml`. Jede neue Datei, die getestet werden soll, muss dort eingetragen werden. `./test.sh` ruft `xcodegen generate` selbst auf.
- `BlitztextWin` wird in diesem Plan nicht angefasst.

---

### Task 1: Datenmodell fuer Tastenkuerzel

Enthaelt die Vorarbeit, die das Testziel braucht: `WorkflowType` wandert in eine eigene Datei, damit es ohne `LocalTranscriptionService` und WhisperKit kompiliert werden kann. `WorkflowProtocol.swift` kann nicht ins Testziel, weil `AppSettings` dort an `LocalTranscriptionService` haengt.

**Files:**
- Create: `BlitztextMac/Features/Workflows/WorkflowType.swift`
- Modify: `BlitztextMac/Features/Workflows/WorkflowProtocol.swift:3-77` (Enum `WorkflowType` entfernen, Rest bleibt)
- Create: `BlitztextMac/Services/HotkeyBinding.swift`
- Create: `BlitztextMac/Tests/HotkeyBindingsTests.swift`
- Modify: `BlitztextMac/project.yml:64-73` (Quellen des Testziels)

**Interfaces:**
- Consumes: `WorkflowType` aus dem Bestand, unveraendert im Verhalten.
- Produces: `HotkeyModifier` (`fn`, `shift`, `control`, `option`, `command`), `HotkeyCombo` mit `init(_ modifiers: Set<HotkeyModifier>)`, `init(_ modifiers: HotkeyModifier...)`, `init(flags: NSEvent.ModifierFlags)`, `modifiers`, `isEmpty`, `eventFlags`, `displayLabel`, `isStrictSubset(of:)`; `HotkeyComboValidation` mit `.ok`, `.tooFewModifiers`, `.alreadyUsed(by: WorkflowType)`; `HotkeyBindings` mit `init(overrides:)`, `static defaultCombo(for:)`, `combo(for:)`, `isDefault(for:)`, `hasOverrides`, `assignments`, `owner(of:excluding:)`, `validate(_:for:)`, `set(_:for:)`, `reset(_:)`, `resetAll()`.

- [ ] **Step 1: `WorkflowType` in eine eigene Datei verschieben**

Neue Datei `BlitztextMac/Features/Workflows/WorkflowType.swift` mit genau dem Enum, das heute in `WorkflowProtocol.swift` steht. `hotkeyLabel` bleibt in diesem Task erhalten, damit die Oberflaeche weiter kompiliert. Es wird erst in Task 5 entfernt.

```swift
import Foundation

// MARK: - Workflow Types

enum WorkflowType: String, CaseIterable, Identifiable, Codable {
    case transcription
    case localTranscription
    case vaultDictation
    case textImprover
    case dampfAblassen
    case emojiText

    var id: String { rawValue }

    static var mainMenuCases: [WorkflowType] {
        allCases.filter { $0 != .localTranscription }
    }

    var displayName: String {
        switch self {
        case .transcription: return "Blitztext"
        case .localTranscription: return "Blitztext Lokal"
        case .vaultDictation: return "Blitztext Notiz"
        case .textImprover: return "Blitztext+"
        case .dampfAblassen: return "Blitztext $%&!"
        case .emojiText: return "Blitztext :)"
        }
    }

    var icon: String {
        switch self {
        case .transcription: return "mic.fill"
        case .localTranscription: return "lock.shield.fill"
        case .vaultDictation: return "tray.and.arrow.down.fill"
        case .textImprover: return "text.badge.checkmark"
        case .dampfAblassen: return "flame.fill"
        case .emojiText: return "face.smiling"
        }
    }

    var subtitle: String {
        switch self {
        case .transcription: return "Sprache rein. Text raus."
        case .localTranscription: return "Nur lokal. Kein Server."
        case .vaultDictation: return "Gedanke rein. Inbox raus."
        case .textImprover: return "Geschrieben sprechen."
        case .dampfAblassen: return "Frust rein. Entspannt raus."
        case .emojiText: return "Text rein. Emojis dazu."
        }
    }

    var hotkeyLabel: String {
        switch self {
        case .transcription: return "fn + Shift"
        case .localTranscription: return "fn + Shift + Ctrl"
        case .vaultDictation: return "fn + Shift + Option"
        case .textImprover: return "fn + Control"
        case .dampfAblassen: return "fn + Option"
        case .emojiText: return "fn + Cmd"
        }
    }

    var accentColor: String {
        switch self {
        case .transcription: return "blue"
        case .localTranscription: return "green"
        case .vaultDictation: return "indigo"
        case .textImprover: return "purple"
        case .dampfAblassen: return "orange"
        case .emojiText: return "cyan"
        }
    }
}
```

Aus `BlitztextMac/Features/Workflows/WorkflowProtocol.swift` denselben Enum-Block loeschen. Die Zeile `// MARK: - Workflow Types` und das Enum verschwinden, `// MARK: - Output Destination` mit `WorkflowOutputDestination` und der `extension WorkflowType`-Block bleiben unveraendert an ihrer Stelle.

- [ ] **Step 2: Bestand bleibt gruen**

Run: `./test.sh`
Expected: Build erfolgreich, alle bestehenden Tests PASS. Wenn der Build bricht, ist ein Teil des Enums doppelt oder fehlt.

- [ ] **Step 3: Testziel um die beiden Dateien erweitern**

In `BlitztextMac/project.yml` im Ziel `BlitztextMacTests` unter `sources` ergaenzen:

```yaml
      - path: Features/Workflows/WorkflowType.swift
      - path: Services/HotkeyBinding.swift
```

- [ ] **Step 4: Die fehlschlagenden Tests schreiben**

Neue Datei `BlitztextMac/Tests/HotkeyBindingsTests.swift`:

```swift
import XCTest
import AppKit

final class HotkeyBindingsTests: XCTestCase {
    func testStandardKombinationenSindGueltigUndKonfliktfrei() {
        var gesehen: Set<HotkeyCombo> = []
        for typ in WorkflowType.allCases {
            let kombination = HotkeyBindings.defaultCombo(for: typ)
            XCTAssertGreaterThanOrEqual(
                kombination.modifiers.count,
                2,
                "\(typ.rawValue) braucht mindestens zwei Modifier"
            )
            XCTAssertTrue(
                gesehen.insert(kombination).inserted,
                "\(typ.rawValue) belegt eine bereits vergebene Kombination"
            )
        }
    }

    func testStandardEntsprichtDenBisherigenKuerzeln() {
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .transcription), HotkeyCombo(.fn, .shift))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .localTranscription), HotkeyCombo(.fn, .shift, .control))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .vaultDictation), HotkeyCombo(.fn, .shift, .option))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .textImprover), HotkeyCombo(.fn, .control))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .dampfAblassen), HotkeyCombo(.fn, .option))
        XCTAssertEqual(HotkeyBindings.defaultCombo(for: .emojiText), HotkeyCombo(.fn, .command))
    }

    func testSetzenUndEinzelnZuruecksetzen() {
        var bindings = HotkeyBindings()
        XCTAssertFalse(bindings.hasOverrides)

        bindings.set(HotkeyCombo(.control, .option), for: .transcription)
        XCTAssertEqual(bindings.combo(for: .transcription), HotkeyCombo(.control, .option))
        XCTAssertFalse(bindings.isDefault(for: .transcription))
        XCTAssertTrue(bindings.hasOverrides)

        bindings.reset(.transcription)
        XCTAssertEqual(bindings.combo(for: .transcription), HotkeyBindings.defaultCombo(for: .transcription))
        XCTAssertTrue(bindings.isDefault(for: .transcription))
        XCTAssertFalse(bindings.hasOverrides)
    }

    func testAllesZuruecksetzen() {
        var bindings = HotkeyBindings()
        bindings.set(HotkeyCombo(.control, .option), for: .transcription)
        bindings.set(HotkeyCombo(.control, .command), for: .emojiText)
        XCTAssertTrue(bindings.hasOverrides)

        bindings.resetAll()
        XCTAssertFalse(bindings.hasOverrides)
        for typ in WorkflowType.allCases {
            XCTAssertEqual(bindings.combo(for: typ), HotkeyBindings.defaultCombo(for: typ))
        }
    }

    func testDasSetzenDesStandardsIstKeineAbweichung() {
        var bindings = HotkeyBindings()
        bindings.set(HotkeyBindings.defaultCombo(for: .emojiText), for: .emojiText)
        XCTAssertFalse(bindings.hasOverrides)
    }

    func testEinzelnerModifierWirdAbgelehnt() {
        let bindings = HotkeyBindings()
        XCTAssertEqual(bindings.validate(HotkeyCombo(.fn), for: .transcription), .tooFewModifiers)
        XCTAssertEqual(bindings.validate(HotkeyCombo(.shift), for: .transcription), .tooFewModifiers)
        XCTAssertEqual(bindings.validate(HotkeyCombo([]), for: .transcription), .tooFewModifiers)
    }

    func testBelegteKombinationWirdMitBesitzerAbgelehnt() {
        let bindings = HotkeyBindings()
        XCTAssertEqual(
            bindings.validate(HotkeyCombo(.fn, .option), for: .transcription),
            .alreadyUsed(by: .dampfAblassen)
        )
        XCTAssertEqual(bindings.owner(of: HotkeyCombo(.fn, .option), excluding: .transcription), .dampfAblassen)
    }

    func testEigeneUnveraenderteKombinationBleibtErlaubt() {
        let bindings = HotkeyBindings()
        XCTAssertEqual(bindings.validate(HotkeyCombo(.fn, .shift), for: .transcription), .ok)
        XCTAssertNil(bindings.owner(of: HotkeyCombo(.fn, .shift), excluding: .transcription))
    }

    func testAnzeigeLabelHatFesteReihenfolge() {
        XCTAssertEqual(HotkeyCombo(.command, .shift, .fn).displayLabel, "fn + Shift + Cmd")
        XCTAssertEqual(HotkeyCombo(.option, .control).displayLabel, "Ctrl + Option")
    }

    func testUmrechnungAusEreignisFlags() {
        let kombination = HotkeyCombo(flags: [.function, .shift, .option, .capsLock])
        XCTAssertEqual(kombination, HotkeyCombo(.fn, .shift, .option))
        XCTAssertTrue(kombination.eventFlags.contains(.function))
        XCTAssertFalse(kombination.eventFlags.contains(.command))
        XCTAssertTrue(HotkeyCombo(flags: []).isEmpty)
    }

    func testEchteTeilmenge() {
        XCTAssertTrue(HotkeyCombo(.fn, .shift).isStrictSubset(of: HotkeyCombo(.fn, .shift, .option)))
        XCTAssertFalse(HotkeyCombo(.fn, .shift).isStrictSubset(of: HotkeyCombo(.fn, .shift)))
        XCTAssertFalse(HotkeyCombo(.fn, .command).isStrictSubset(of: HotkeyCombo(.fn, .shift, .option)))
    }

    func testCodableRundlauf() throws {
        var bindings = HotkeyBindings()
        bindings.set(HotkeyCombo(.control, .option), for: .emojiText)

        let daten = try JSONEncoder().encode(bindings)
        let geladen = try JSONDecoder().decode(HotkeyBindings.self, from: daten)

        XCTAssertEqual(geladen, bindings)
        XCTAssertEqual(geladen.combo(for: .emojiText), HotkeyCombo(.control, .option))
    }

    func testLeeresJsonLiefertStandards() throws {
        let geladen = try JSONDecoder().decode(HotkeyBindings.self, from: Data("{}".utf8))
        XCTAssertFalse(geladen.hasOverrides)
        XCTAssertEqual(geladen.combo(for: .transcription), HotkeyCombo(.fn, .shift))
    }

    func testUnbrauchbareEintraegeWerdenVerworfen() throws {
        let json = """
        {"transcription":["fn","hyper"],"gibtEsNicht":["fn","shift"],"emojiText":["control","option"]}
        """
        let geladen = try JSONDecoder().decode(HotkeyBindings.self, from: Data(json.utf8))

        // "hyper" faellt weg, damit bleibt nur ein Modifier uebrig und der
        // Eintrag wird verworfen. Der unbekannte Workflow-Schluessel ebenso.
        XCTAssertEqual(geladen.combo(for: .transcription), HotkeyBindings.defaultCombo(for: .transcription))
        XCTAssertEqual(geladen.combo(for: .emojiText), HotkeyCombo(.control, .option))
    }
}
```

- [ ] **Step 5: Tests laufen lassen und Fehlschlag bestaetigen**

Run: `./test.sh -only-testing:BlitztextMacTests/HotkeyBindingsTests`
Expected: FAIL. Der Build bricht mit "cannot find 'HotkeyBindings' in scope" und "cannot find 'HotkeyCombo' in scope", weil `HotkeyBinding.swift` noch fehlt.

- [ ] **Step 6: Das Modell implementieren**

Neue Datei `BlitztextMac/Services/HotkeyBinding.swift`:

```swift
import AppKit

// MARK: - Modifier

/// Ein einzelner Modifier, aus dem sich ein Tastenkuerzel zusammensetzt.
/// Die rawValues landen im gespeicherten JSON und duerfen sich nicht aendern.
enum HotkeyModifier: String, Codable, CaseIterable, Comparable {
    case fn
    case shift
    case control
    case option
    case command

    /// Reihenfolge fuer Anzeige und stabile Serialisierung.
    private var sortIndex: Int {
        switch self {
        case .fn: return 0
        case .shift: return 1
        case .control: return 2
        case .option: return 3
        case .command: return 4
        }
    }

    static func < (lhs: HotkeyModifier, rhs: HotkeyModifier) -> Bool {
        lhs.sortIndex < rhs.sortIndex
    }

    /// Kurzform fuer die Anzeige. Kurz, damit das Badge in der schmalen
    /// Menueleisten-Ansicht nicht umbricht.
    var displayName: String {
        switch self {
        case .fn: return "fn"
        case .shift: return "Shift"
        case .control: return "Ctrl"
        case .option: return "Option"
        case .command: return "Cmd"
        }
    }

    var eventFlag: NSEvent.ModifierFlags {
        switch self {
        case .fn: return .function
        case .shift: return .shift
        case .control: return .control
        case .option: return .option
        case .command: return .command
        }
    }
}

// MARK: - Kombination

/// Eine Menge gleichzeitig gehaltener Modifier. Normale Tasten kommen bewusst
/// nicht vor, damit die `flagsChanged`-Mechanik und der Halten-Modus tragen.
struct HotkeyCombo: Codable, Hashable {
    var modifiers: Set<HotkeyModifier>

    init(_ modifiers: Set<HotkeyModifier>) {
        self.modifiers = modifiers
    }

    init(_ modifiers: HotkeyModifier...) {
        self.modifiers = Set(modifiers)
    }

    /// Baut die Kombination aus den Flags eines Tastaturereignisses. Flags ohne
    /// eigenen Modifier, etwa CapsLock, werden ignoriert.
    init(flags: NSEvent.ModifierFlags) {
        let relevant = flags.intersection(.deviceIndependentFlagsMask)
        modifiers = Set(HotkeyModifier.allCases.filter { relevant.contains($0.eventFlag) })
    }

    var isEmpty: Bool { modifiers.isEmpty }

    var eventFlags: NSEvent.ModifierFlags {
        modifiers.reduce(into: NSEvent.ModifierFlags()) { $0.insert($1.eventFlag) }
    }

    var displayLabel: String {
        modifiers.sorted().map(\.displayName).joined(separator: " + ")
    }

    /// True, wenn diese Kombination echte Teilmenge der anderen ist, also beim
    /// Druecken der anderen zwangslaeufig zwischendurch anliegt.
    func isStrictSubset(of other: HotkeyCombo) -> Bool {
        modifiers.isStrictSubset(of: other.modifiers)
    }

    // Als sortiertes Array serialisiert, damit das JSON stabil bleibt.
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let roh = try container.decode([String].self)
        modifiers = Set(roh.compactMap(HotkeyModifier.init(rawValue:)))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(modifiers.sorted().map(\.rawValue))
    }
}

// MARK: - Pruefergebnis

enum HotkeyComboValidation: Equatable {
    case ok
    case tooFewModifiers
    case alreadyUsed(by: WorkflowType)
}

// MARK: - Zuordnung

/// Die Tastenkuerzel aller Workflows. Gespeichert werden nur Abweichungen vom
/// Standard, damit das Zuruecksetzen ein Loeschen ist und Bestandsnutzer
/// kuenftige Standardaenderungen erben.
struct HotkeyBindings: Codable, Equatable {
    static let minimumModifierCount = 2

    private var overrides: [WorkflowType: HotkeyCombo]

    init(overrides: [WorkflowType: HotkeyCombo] = [:]) {
        self.overrides = overrides
    }

    static func defaultCombo(for type: WorkflowType) -> HotkeyCombo {
        switch type {
        case .transcription: return HotkeyCombo(.fn, .shift)
        case .localTranscription: return HotkeyCombo(.fn, .shift, .control)
        case .vaultDictation: return HotkeyCombo(.fn, .shift, .option)
        case .textImprover: return HotkeyCombo(.fn, .control)
        case .dampfAblassen: return HotkeyCombo(.fn, .option)
        case .emojiText: return HotkeyCombo(.fn, .command)
        }
    }

    func combo(for type: WorkflowType) -> HotkeyCombo {
        overrides[type] ?? Self.defaultCombo(for: type)
    }

    func isDefault(for type: WorkflowType) -> Bool {
        combo(for: type) == Self.defaultCombo(for: type)
    }

    var hasOverrides: Bool {
        WorkflowType.allCases.contains { !isDefault(for: $0) }
    }

    /// Alle vergebenen Kombinationen, die laengste zuerst.
    var assignments: [(type: WorkflowType, combo: HotkeyCombo)] {
        WorkflowType.allCases
            .map { (type: $0, combo: combo(for: $0)) }
            .sorted { $0.combo.modifiers.count > $1.combo.modifiers.count }
    }

    func owner(of combo: HotkeyCombo, excluding type: WorkflowType) -> WorkflowType? {
        WorkflowType.allCases.first { $0 != type && self.combo(for: $0) == combo }
    }

    func validate(_ combo: HotkeyCombo, for type: WorkflowType) -> HotkeyComboValidation {
        guard combo.modifiers.count >= Self.minimumModifierCount else { return .tooFewModifiers }
        if let besitzer = owner(of: combo, excluding: type) { return .alreadyUsed(by: besitzer) }
        return .ok
    }

    mutating func set(_ combo: HotkeyCombo, for type: WorkflowType) {
        if combo == Self.defaultCombo(for: type) {
            overrides[type] = nil
        } else {
            overrides[type] = combo
        }
    }

    mutating func reset(_ type: WorkflowType) {
        overrides[type] = nil
    }

    mutating func resetAll() {
        overrides.removeAll()
    }

    // Als Objekt mit den rawValues der Workflows als Schluessel serialisiert.
    // Unbekannte Schluessel und unbrauchbare Kombinationen werden beim Laden
    // verworfen, der betroffene Workflow faellt dann auf seinen Standard.
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let roh = try container.decode([String: HotkeyCombo].self)
        var abweichungen: [WorkflowType: HotkeyCombo] = [:]
        for (schluessel, kombination) in roh {
            guard let typ = WorkflowType(rawValue: schluessel),
                  kombination.modifiers.count >= Self.minimumModifierCount else { continue }
            abweichungen[typ] = kombination
        }
        overrides = abweichungen
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        var roh: [String: HotkeyCombo] = [:]
        for (typ, kombination) in overrides {
            roh[typ.rawValue] = kombination
        }
        try container.encode(roh)
    }
}
```

- [ ] **Step 7: Tests laufen lassen**

Run: `./test.sh -only-testing:BlitztextMacTests/HotkeyBindingsTests`
Expected: PASS, alle 14 Testmethoden.

- [ ] **Step 8: Commit**

```bash
git add BlitztextMac/Features/Workflows/WorkflowType.swift BlitztextMac/Features/Workflows/WorkflowProtocol.swift BlitztextMac/Services/HotkeyBinding.swift BlitztextMac/Tests/HotkeyBindingsTests.swift BlitztextMac/project.yml BlitztextMac/BlitztextMac.xcodeproj
git commit -m "Update: Datenmodell fuer anpassbare Tastenkuerzel"
```

---

### Task 2: Entscheidungslogik `HotkeyMatcher`

**Files:**
- Create: `BlitztextMac/Services/HotkeyMatcher.swift`
- Create: `BlitztextMac/Tests/HotkeyMatcherTests.swift`
- Modify: `BlitztextMac/project.yml` (Quellen des Testziels um `Services/HotkeyMatcher.swift` erweitern)

**Interfaces:**
- Consumes: `HotkeyBindings`, `HotkeyCombo`, `WorkflowType` aus Task 1.
- Produces: `HotkeyDecision` mit `.fire(WorkflowType)`, `.delayed(WorkflowType, delay: TimeInterval)`, `.release(WorkflowType)`, `.none`; `HotkeyMatcher` mit `init(bindings: HotkeyBindings)`, `static let prefixDelay: TimeInterval`, `func decision(for combo: HotkeyCombo, active: WorkflowType?) -> HotkeyDecision`, `func isPrefixOfOtherAssignment(_ combo: HotkeyCombo) -> Bool`.

- [ ] **Step 1: Testziel erweitern**

In `BlitztextMac/project.yml` im Ziel `BlitztextMacTests` unter `sources` ergaenzen:

```yaml
      - path: Services/HotkeyMatcher.swift
```

- [ ] **Step 2: Die fehlschlagenden Tests schreiben**

Neue Datei `BlitztextMac/Tests/HotkeyMatcherTests.swift`:

```swift
import XCTest

final class HotkeyMatcherTests: XCTestCase {
    private let matcher = HotkeyMatcher(bindings: HotkeyBindings())

    func testKombinationOhnePraefixKonfliktFeuertSofort() {
        // fn + Cmd ist in keiner anderen vergebenen Kombination enthalten.
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.fn, .command), active: nil), .fire(.emojiText))
    }

    func testPraefixKombinationWartet() {
        // fn + Shift steckt in fn + Shift + Ctrl und fn + Shift + Option.
        XCTAssertEqual(
            matcher.decision(for: HotkeyCombo(.fn, .shift), active: nil),
            .delayed(.transcription, delay: 0.15)
        )
        XCTAssertTrue(matcher.isPrefixOfOtherAssignment(HotkeyCombo(.fn, .shift)))
    }

    func testLaengereKombinationFeuertSofort() {
        XCTAssertEqual(
            matcher.decision(for: HotkeyCombo(.fn, .shift, .option), active: nil),
            .fire(.vaultDictation)
        )
        XCTAssertFalse(matcher.isPrefixOfOtherAssignment(HotkeyCombo(.fn, .shift, .option)))
    }

    func testLoslassenLiefertRelease() {
        XCTAssertEqual(matcher.decision(for: HotkeyCombo([]), active: .transcription), .release(.transcription))
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.fn), active: .transcription), .release(.transcription))
    }

    func testUnbelegteKombinationTutNichts() {
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.shift, .command), active: nil), .none)
        XCTAssertEqual(matcher.decision(for: HotkeyCombo([]), active: nil), .none)
    }

    func testWeitereModifierWaehrendEinerAufnahmeAendernNichts() {
        // Wie im Bestand: laeuft schon eine Aufnahme, wird eine andere
        // Kombination ignoriert statt die laufende zu beenden.
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.fn, .shift, .option), active: .transcription), .none)
        XCTAssertEqual(matcher.decision(for: HotkeyCombo(.fn, .shift), active: .transcription), .none)
    }

    func testEigeneKuerzelWerdenBeachtet() {
        var bindings = HotkeyBindings()
        bindings.set(HotkeyCombo(.control, .option), for: .transcription)
        let eigener = HotkeyMatcher(bindings: bindings)

        XCTAssertEqual(eigener.decision(for: HotkeyCombo(.control, .option), active: nil), .fire(.transcription))
        // fn + Shift ist jetzt nicht mehr vergeben.
        XCTAssertEqual(eigener.decision(for: HotkeyCombo(.fn, .shift), active: nil), .none)
        // fn + Shift + Option bleibt vergeben und hat keinen Praefix-Konflikt.
        XCTAssertEqual(eigener.decision(for: HotkeyCombo(.fn, .shift, .option), active: nil), .fire(.vaultDictation))
    }

    func testWartezeitIstEineFesteGroesse() {
        XCTAssertEqual(HotkeyMatcher.prefixDelay, 0.15, accuracy: 0.0001)
    }
}
```

- [ ] **Step 3: Tests laufen lassen und Fehlschlag bestaetigen**

Run: `./test.sh -only-testing:BlitztextMacTests/HotkeyMatcherTests`
Expected: FAIL. Build bricht mit "cannot find 'HotkeyMatcher' in scope".

- [ ] **Step 4: Den Matcher implementieren**

Neue Datei `BlitztextMac/Services/HotkeyMatcher.swift`:

```swift
import Foundation

/// Was bei den aktuell gehaltenen Modifiern zu tun ist.
enum HotkeyDecision: Equatable {
    /// Sofort starten.
    case fire(WorkflowType)
    /// Erst nach der Wartezeit starten, weil die Kombination Teilmenge einer
    /// anderen vergebenen Kombination ist und noch ein Modifier folgen kann.
    case delayed(WorkflowType, delay: TimeInterval)
    /// Die laufende Aufnahme beenden.
    case release(WorkflowType)
    /// Nichts zu tun.
    case none
}

/// Reine Entscheidungslogik der Tastenkuerzel, ohne AppKit-Zustand, damit sie
/// ohne echte Tastaturereignisse getestet werden kann.
struct HotkeyMatcher {
    /// Wartezeit fuer Praefix-Kombinationen.
    static let prefixDelay: TimeInterval = 0.15

    let bindings: HotkeyBindings

    init(bindings: HotkeyBindings) {
        self.bindings = bindings
    }

    func decision(for combo: HotkeyCombo, active: WorkflowType?) -> HotkeyDecision {
        if let treffer = match(for: combo) {
            // Laeuft schon eine Aufnahme, bleibt sie unangetastet.
            guard active == nil else { return .none }
            return isPrefixOfOtherAssignment(combo)
                ? .delayed(treffer, delay: Self.prefixDelay)
                : .fire(treffer)
        }
        if let active { return .release(active) }
        return .none
    }

    /// True, wenn die Kombination echte Teilmenge einer vergebenen Kombination
    /// ist und deshalb beim Druecken der laengeren zwangslaeufig anliegt.
    func isPrefixOfOtherAssignment(_ combo: HotkeyCombo) -> Bool {
        bindings.assignments.contains { combo.isStrictSubset(of: $0.combo) }
    }

    private func match(for combo: HotkeyCombo) -> WorkflowType? {
        guard !combo.isEmpty else { return nil }
        return bindings.assignments.first { $0.combo == combo }?.type
    }
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `./test.sh -only-testing:BlitztextMacTests/HotkeyMatcherTests`
Expected: PASS, alle 8 Testmethoden.

- [ ] **Step 6: Gesamtsuite pruefen**

Run: `./test.sh`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add BlitztextMac/Services/HotkeyMatcher.swift BlitztextMac/Tests/HotkeyMatcherTests.swift BlitztextMac/project.yml BlitztextMac/BlitztextMac.xcodeproj
git commit -m "Update: Entscheidungslogik fuer Tastenkuerzel mit Wartezeit bei Praefixen"
```

---

### Task 3: Speicherung und datengetriebener `HotkeyService`

Nach diesem Task laufen die Kuerzel ueber die Bindings, verhalten sich aber nach aussen wie bisher, weil noch keine Abweichungen gesetzt werden koennen. Der `HotkeyService` selbst hat keine Unit-Tests, weil er nur AppKit-Monitore und Zeitgeber haelt. Die Logik dahinter deckt `HotkeyMatcherTests` ab, das Zusammenspiel wird manuell geprueft.

Zwei bewusste Abweichungen von der Spec:

- Die geladenen Kuerzel werden in `AppState.init()` an den Dienst gegeben, nicht in `BlitztextMacApp`. Gleiche Wirkung, aber unabhaengig davon, ob der App-Delegate den Schritt vergisst.
- Das Verwerfen einer verzoegerten Entscheidung bei einer Flag-Aenderung liegt in `HotkeyService.cancelPending()` und damit ausserhalb des reinen Wertetyps. Es gibt dafuer keinen Unit-Test, geprueft wird es manuell in Step 5, Punkt 2.

**Files:**
- Modify: `BlitztextMac/Features/Workflows/WorkflowProtocol.swift` (`AppSettings`: Feld, Init-Parameter, `CodingKeys`, Decoder)
- Modify: `BlitztextMac/Services/HotkeyService.swift` (komplett ersetzt)
- Modify: `BlitztextMac/App/AppState.swift:44-49` (didSet), `:124-140` (init), plus neuer Abschnitt mit den Hotkey-Hilfsfunktionen

**Interfaces:**
- Consumes: `HotkeyBindings`, `HotkeyCombo`, `HotkeyComboValidation` aus Task 1, `HotkeyMatcher`, `HotkeyDecision` aus Task 2.
- Produces: `AppSettings.hotkeyBindings: HotkeyBindings`; `HotkeyService.bindings: HotkeyBindings`, `HotkeyService.suspend()`, `HotkeyService.resume()`; `AppState.hotkeyLabel(for: WorkflowType) -> String`, `AppState.setHotkey(_ combo: HotkeyCombo, for type: WorkflowType) -> HotkeyComboValidation`, `AppState.resetHotkey(_ type: WorkflowType)`, `AppState.resetAllHotkeys()`.

- [ ] **Step 1: Feld in `AppSettings` ergaenzen**

In `BlitztextMac/Features/Workflows/WorkflowProtocol.swift` im Struct `AppSettings` vier Stellen anpassen.

Neues Feld direkt unter `var hotkeyMode: HotkeyMode = .hold`:

```swift
    var hotkeyBindings: HotkeyBindings = HotkeyBindings()
```

Im Init die Signatur um den Parameter erweitern, direkt nach `hotkeyMode`:

```swift
        hotkeyBindings: HotkeyBindings = HotkeyBindings(),
```

und im Init-Rumpf direkt nach `self.hotkeyMode = hotkeyMode`:

```swift
        self.hotkeyBindings = hotkeyBindings
```

In `CodingKeys` nach `case hotkeyMode`:

```swift
        case hotkeyBindings
```

In `init(from:)` nach der Zeile fuer `hotkeyMode`:

```swift
        hotkeyBindings = try container.decodeIfPresent(
            HotkeyBindings.self,
            forKey: .hotkeyBindings
        ) ?? HotkeyBindings()
```

- [ ] **Step 2: `HotkeyService` datengetrieben neu schreiben**

`BlitztextMac/Services/HotkeyService.swift` vollstaendig ersetzen. `HotkeyMode` und `HotkeyEvent` bleiben unveraendert, nur die Klasse wird umgebaut.

```swift
import Cocoa
import Observation

enum HotkeyMode: String, Codable, CaseIterable, Identifiable {
    case hold    // Tasten halten = aufnehmen, loslassen = stoppen
    case toggle  // Einmal drücken = starten, nochmal/Escape = stoppen

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .hold: return "Halten"
        case .toggle: return "Drücken"
        }
    }

    var description: String {
        switch self {
        case .hold: return "Tasten halten zum Aufnehmen, loslassen zum Stoppen"
        case .toggle: return "Einmal drücken zum Starten, nochmal oder Escape zum Stoppen"
        }
    }
}

enum HotkeyEvent {
    case down(WorkflowType)  // Keys pressed
    case up(WorkflowType)    // Keys released (for hold mode)
    case cancel              // Escape pressed
}

@Observable
@MainActor
final class HotkeyService {
    /// Die aktuell vergebenen Kuerzel. Wird vom AppState gesetzt.
    var bindings = HotkeyBindings()

    var onHotkeyEvent: ((HotkeyEvent) -> Void)?

    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var keyMonitor: Any?
    /// Kombination, die gerade gehalten wird.
    private var activeCombo: WorkflowType?
    /// Laufende Wartezeit fuer eine Praefix-Kombination.
    private var pendingTask: Task<Void, Never>?
    /// Solange true, liefert der Dienst keine Ereignisse. Wird beim Aufnehmen
    /// eines neuen Kuerzels in den Einstellungen gesetzt.
    private var isSuspended = false

    func start() {
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            let flags = event.modifierFlags
            Task { @MainActor in
                self?.handleFlags(flags)
            }
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            let flags = event.modifierFlags
            Task { @MainActor in
                self?.handleFlags(flags)
            }
            return event
        }
        // Escape key monitor for toggle mode
        keyMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let keyCode = event.keyCode
            Task { @MainActor in
                if keyCode == 53 { // Escape
                    self?.handleEscape()
                }
            }
        }
    }

    func stop() {
        cancelPending()
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        globalMonitor = nil
        localMonitor = nil
        keyMonitor = nil
    }

    /// Legt den Dienst still, ohne die Monitore abzubauen. Waehrend der
    /// Aufnahme eines neuen Kuerzels darf kein Workflow starten.
    func suspend() {
        isSuspended = true
        cancelPending()
        activeCombo = nil
    }

    func resume() {
        isSuspended = false
    }

    private func handleFlags(_ flags: NSEvent.ModifierFlags) {
        guard !isSuspended else { return }

        cancelPending()

        let combo = HotkeyCombo(flags: flags)
        switch HotkeyMatcher(bindings: bindings).decision(for: combo, active: activeCombo) {
        case .fire(let type):
            activeCombo = type
            onHotkeyEvent?(.down(type))

        case .delayed(let type, let delay):
            pendingTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(delay))
                guard !Task.isCancelled else { return }
                self?.firePending(type, combo: combo)
            }

        case .release(let type):
            activeCombo = nil
            onHotkeyEvent?(.up(type))

        case .none:
            break
        }
    }

    /// Feuert nach abgelaufener Wartezeit, aber nur wenn die Tasten unveraendert
    /// gehalten werden.
    private func firePending(_ type: WorkflowType, combo: HotkeyCombo) {
        pendingTask = nil
        guard !isSuspended, activeCombo == nil else { return }
        guard HotkeyCombo(flags: NSEvent.modifierFlags) == combo else { return }
        activeCombo = type
        onHotkeyEvent?(.down(type))
    }

    private func cancelPending() {
        pendingTask?.cancel()
        pendingTask = nil
    }

    private func handleEscape() {
        guard !isSuspended else { return }
        cancelPending()
        activeCombo = nil
        onHotkeyEvent?(.cancel)
    }
}
```

- [ ] **Step 3: Bindings im `AppState` verteilen und Hilfsfunktionen ergaenzen**

In `BlitztextMac/App/AppState.swift` im `didSet` von `appSettings` die Verteilung ergaenzen:

```swift
    var appSettings: AppSettings {
        didSet {
            saveSettings()
            hotkeyService.bindings = appSettings.hotkeyBindings
            prewarmLocalTranscriptionIfNeeded()
        }
    }
```

Am Ende von `init()`, direkt nach `self.dictationSettings = Self.loadDictationSettings()`, die geladenen Kuerzel einmal setzen. Der `didSet` feuert im Init nicht.

```swift
        hotkeyService.bindings = appSettings.hotkeyBindings
```

Und einen neuen Abschnitt direkt vor `// MARK: - Custom Display Names` einfuegen:

```swift
    // MARK: - Tastenkuerzel

    func hotkeyLabel(for type: WorkflowType) -> String {
        appSettings.hotkeyBindings.combo(for: type).displayLabel
    }

    /// Prueft und speichert eine neue Kombination. Bei einem Fehler bleibt die
    /// gespeicherte Kombination unveraendert.
    @discardableResult
    func setHotkey(_ combo: HotkeyCombo, for type: WorkflowType) -> HotkeyComboValidation {
        let ergebnis = appSettings.hotkeyBindings.validate(combo, for: type)
        guard ergebnis == .ok else { return ergebnis }
        appSettings.hotkeyBindings.set(combo, for: type)
        return .ok
    }

    func resetHotkey(_ type: WorkflowType) {
        appSettings.hotkeyBindings.reset(type)
    }

    func resetAllHotkeys() {
        appSettings.hotkeyBindings.resetAll()
    }

    var hasCustomHotkeys: Bool {
        appSettings.hotkeyBindings.hasOverrides
    }
```

- [ ] **Step 4: Gesamtsuite pruefen**

Run: `./test.sh`
Expected: PASS. Der Umbau darf keinen bestehenden Test brechen.

- [ ] **Step 5: App bauen und die Kuerzel von Hand pruefen**

Run: `./build.sh --debug --run`

Zu pruefen, mit der laufenden App im Halten-Modus:

1. fn + Shift halten startet Blitztext, loslassen beendet die Aufnahme.
2. fn + Shift + Option startet Blitztext Notiz und nicht Blitztext. Das ist der bisher fehlerhafte Fall, die Wartezeit soll ihn zuverlaessig machen. Mehrfach probieren, auch mit langsamem Nachdruecken von Option.
3. fn + Control startet Blitztext+, fn + Option startet Blitztext $%&!, fn + Cmd startet Blitztext :).
4. Im Modus Druecken beendet Escape eine laufende Aufnahme.

Nicht weitergehen, solange einer der Punkte nicht stimmt.

- [ ] **Step 6: Commit**

```bash
git add BlitztextMac/Features/Workflows/WorkflowProtocol.swift BlitztextMac/Services/HotkeyService.swift BlitztextMac/App/AppState.swift
git commit -m "Update: Tastenkuerzel kommen aus den Einstellungen statt aus festem Code"
```

---

### Task 4: Aufnahmezeile und Zuruecksetzen in den Einstellungen

**Files:**
- Create: `BlitztextMac/Features/Settings/HotkeyRecorderRow.swift`
- Modify: `BlitztextMac/Features/Settings/SettingsContentView.swift:1017-1047` (Abschnitt Tastenkuerzel)

**Interfaces:**
- Consumes: `AppState.hotkeyLabel(for:)`, `AppState.setHotkey(_:for:)`, `AppState.resetHotkey(_:)`, `AppState.resetAllHotkeys()`, `AppState.hasCustomHotkeys`, `AppState.displayName(for:)`, `HotkeyService.suspend()`, `HotkeyService.resume()`, `HotkeyCombo`, `HotkeyComboValidation`.
- Produces: `HotkeyRecorder` (Klasse, haelt die Monitore der laufenden Aufnahme) und `HotkeyRecorderRow` (View mit `type:`, `appState:`, `recordingType:`).

Wichtig zur Aufteilung: `suspend()` und `resume()` schaltet **der Abschnitt** anhand von `recordingType`, nicht die einzelne Zeile. Wuerde jede Zeile selbst schalten, koennte ein Wechsel zwischen zwei Zeilen den Dienst mitten in einer Aufnahme wieder freigeben.

- [ ] **Step 1: Aufnahmezeile anlegen**

Neue Datei `BlitztextMac/Features/Settings/HotkeyRecorderRow.swift`:

```swift
import SwiftUI
import AppKit

/// Nimmt eine Modifier-Kombination auf. Gemerkt wird die groesste gleichzeitig
/// gehaltene Menge, uebernommen wird sie beim Loslassen aller Modifier.
@Observable
@MainActor
final class HotkeyRecorder {
    private(set) var groessteKombination = HotkeyCombo([])
    private(set) var laeuft = false

    private var monitore: [Any] = []
    private var onCommit: ((HotkeyCombo) -> Void)?
    private var onCancel: (() -> Void)?

    func start(onCommit: @escaping (HotkeyCombo) -> Void, onCancel: @escaping () -> Void) {
        stopMonitore()
        self.onCommit = onCommit
        self.onCancel = onCancel
        groessteKombination = HotkeyCombo([])
        laeuft = true

        let lokal = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            let flags = event.modifierFlags
            Task { @MainActor in
                self?.verarbeite(flags: flags)
            }
            return nil
        }
        // Greift, falls die Modifier gedrueckt werden, waehrend eine andere App
        // den Tastaturfokus hat.
        let global = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            let flags = event.modifierFlags
            Task { @MainActor in
                self?.verarbeite(flags: flags)
            }
        }
        let escape = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return event }
            Task { @MainActor in
                self?.abbrechen()
            }
            return nil
        }
        monitore = [lokal, global, escape].compactMap { $0 }
    }

    func abbrechen() {
        guard laeuft else { return }
        let handler = onCancel
        beende()
        handler?()
    }

    private func verarbeite(flags: NSEvent.ModifierFlags) {
        guard laeuft else { return }
        let kombination = HotkeyCombo(flags: flags)

        guard kombination.isEmpty else {
            if kombination.modifiers.count > groessteKombination.modifiers.count {
                groessteKombination = kombination
            }
            return
        }

        // Alle Modifier losgelassen: die groesste gehaltene Menge gilt.
        let ergebnis = groessteKombination
        guard !ergebnis.isEmpty else { return }
        let handler = onCommit
        beende()
        handler?(ergebnis)
    }

    private func beende() {
        stopMonitore()
        laeuft = false
        groessteKombination = HotkeyCombo([])
        onCommit = nil
        onCancel = nil
    }

    private func stopMonitore() {
        for monitor in monitore { NSEvent.removeMonitor(monitor) }
        monitore = []
    }
}

/// Eine Zeile im Abschnitt Tastenkuerzel: Name, aktuelles Kuerzel,
/// Zuruecksetzen und Aufnahme.
struct HotkeyRecorderRow: View {
    let type: WorkflowType
    let appState: AppState
    /// Welche Zeile gerade aufnimmt. Es darf immer nur eine sein.
    @Binding var recordingType: WorkflowType?

    @State private var recorder = HotkeyRecorder()
    @State private var fehlertext: String?

    private var nimmtAuf: Bool { recordingType == type }

    private var badgeText: String {
        guard nimmtAuf else { return appState.hotkeyLabel(for: type) }
        return recorder.groessteKombination.isEmpty
            ? "Tasten dr\u{00FC}cken"
            : recorder.groessteKombination.displayLabel
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(badgeText)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(nimmtAuf ? Color.accentColor : .secondary)
                    .frame(width: 124, alignment: .leading)

                Text(appState.displayName(for: type))
                    .font(.system(size: 11.5, weight: .medium))
                    .lineLimit(1)

                Spacer()

                if !nimmtAuf && !appState.appSettings.hotkeyBindings.isDefault(for: type) {
                    Button {
                        appState.resetHotkey(type)
                    } label: {
                        Image(systemName: "arrow.uturn.backward")
                    }
                    .buttonStyle(.borderless)
                    .font(.system(size: 10.5))
                    .help("Auf Standard zur\u{00FC}cksetzen")
                }

                Button(nimmtAuf ? "Abbrechen" : "\u{00C4}ndern") {
                    if nimmtAuf {
                        beendeAufnahme()
                    } else {
                        starteAufnahme()
                    }
                }
                .font(.system(size: 11))
            }

            if let fehlertext {
                Text(fehlertext)
                    .font(.system(size: 10.5))
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onChange(of: recordingType) { _, neu in
            // Eine andere Zeile hat die Aufnahme uebernommen.
            if neu != type, recorder.laeuft {
                recorder.abbrechen()
            }
            if neu != type {
                fehlertext = nil
            }
        }
        .onDisappear {
            if recorder.laeuft { recorder.abbrechen() }
        }
    }

    private func starteAufnahme() {
        fehlertext = nil
        recordingType = type
        horcheAufKombination()
    }

    private func horcheAufKombination() {
        recorder.start(
            onCommit: { kombination in
                uebernehme(kombination)
            },
            onCancel: {
                beendeAufnahme()
            }
        )
    }

    private func uebernehme(_ kombination: HotkeyCombo) {
        switch appState.setHotkey(kombination, for: type) {
        case .ok:
            fehlertext = nil
            beendeAufnahme()
        case .tooFewModifiers:
            fehlertext = "Mindestens zwei Modifier, zum Beispiel fn + Shift."
            // Zeile bleibt in Aufnahme, damit direkt ein zweiter Versuch geht.
            horcheAufKombination()
        case .alreadyUsed(let anderer):
            fehlertext = "Belegt von \(appState.displayName(for: anderer))."
            horcheAufKombination()
        }
    }

    private func beendeAufnahme() {
        if recorder.laeuft { recorder.abbrechen() }
        if recordingType == type { recordingType = nil }
    }
}
```

- [ ] **Step 2: Abschnitt in den Einstellungen ersetzen**

In `BlitztextMac/Features/Settings/SettingsContentView.swift` im Struct `CustomizeSettingsView` zuerst zwei `@State`-Eigenschaften neben `selectedTab`-artige Zustaende der View ergaenzen. Sie gehoeren in den Eigenschaftsblock am Anfang von `CustomizeSettingsView`:

```swift
    @State private var recordingHotkeyType: WorkflowType?
    @State private var zeigtHotkeyReset = false
```

Dann den Block ab `// MARK: Tastenkuerzel` bis zum Ende des Modus-Pickers, also die heutigen Zeilen 1017 bis 1047, durch diesen ersetzen:

```swift
            // MARK: Tastenkuerzel
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text: "Tastenk\u{00FC}rzel")

                Text("Erlaubt sind Kombinationen aus mindestens zwei der Tasten fn, Shift, Ctrl, Option und Cmd.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 6) {
                    ForEach(WorkflowType.mainMenuCases) { type in
                        HotkeyRecorderRow(
                            type: type,
                            appState: appState,
                            recordingType: $recordingHotkeyType
                        )
                    }
                }

                Button("Alle Tastenk\u{00FC}rzel zur\u{00FC}cksetzen") {
                    zeigtHotkeyReset = true
                }
                .font(.system(size: 11))
                .disabled(!appState.hasCustomHotkeys)
                .confirmationDialog(
                    "Alle Tastenk\u{00FC}rzel auf den Standard zur\u{00FC}cksetzen?",
                    isPresented: $zeigtHotkeyReset,
                    titleVisibility: .visible
                ) {
                    Button("Zur\u{00FC}cksetzen", role: .destructive) {
                        recordingHotkeyType = nil
                        appState.resetAllHotkeys()
                    }
                    Button("Abbrechen", role: .cancel) {}
                } message: {
                    Text("Eigene Kombinationen gehen dabei verloren.")
                }

                // Mode picker
                VStack(alignment: .leading, spacing: 8) {
                    Text("Modus")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)

                    Picker("", selection: $appState.appSettings.hotkeyMode) {
                        ForEach(HotkeyMode.allCases) { mode in
                            Text(mode.displayName).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .onChange(of: recordingHotkeyType) { _, neu in
                // Waehrend der Aufnahme darf kein Workflow starten.
                if neu == nil {
                    appState.hotkeyService.resume()
                } else {
                    appState.hotkeyService.suspend()
                }
            }
            .onDisappear {
                recordingHotkeyType = nil
                appState.hotkeyService.resume()
            }
```

Beachten: `WorkflowType.mainMenuCases` laesst `localTranscription` aus, genau wie die bisherige Liste. Das Kuerzel fuer den lokalen Modus bleibt damit unveraendert beim Standard.

- [ ] **Step 3: Bauen und Tests**

Run: `./test.sh`
Expected: PASS, Build ohne Warnungen zu unbenutzten Variablen.

- [ ] **Step 4: Aufnahme von Hand pruefen**

Run: `./build.sh --debug --run`

In den Einstellungen, Tab Anpassen, Abschnitt Tastenkuerzel:

1. "Aendern" bei Blitztext, dann Ctrl + Option halten und loslassen. Das Badge zeigt danach "Ctrl + Option", das Zuruecksetzen-Symbol erscheint in der Zeile.
2. Waehrend der Aufnahme darf kein Workflow starten und kein Aufnahmefenster erscheinen.
3. Ctrl + Option in einer anderen App halten startet jetzt Blitztext, fn + Shift nicht mehr.
4. "Aendern" und nur Shift druecken und loslassen: Fehlertext "Mindestens zwei Modifier, zum Beispiel fn + Shift.", das gespeicherte Kuerzel bleibt unveraendert, die Zeile nimmt weiter auf.
5. "Aendern" bei Blitztext+ und fn + Cmd aufnehmen: Fehlertext "Belegt von Blitztext :)."
6. Escape und der Knopf "Abbrechen" beenden die Aufnahme, ohne etwas zu speichern.
7. Zuruecksetzen-Symbol in der Zeile stellt fn + Shift wieder her, das Symbol verschwindet danach.
8. "Alle Tastenkuerzel zuruecksetzen" ist ohne Abweichungen ausgegraut, mit Abweichungen fragt es nach und stellt danach alle Standards her.
9. Einstellungen schliessen, App neu starten: gesetzte Kuerzel sind noch da.
10. Nach dem Schliessen der Einstellungen mitten in einer Aufnahme reagieren die Kuerzel wieder normal.

- [ ] **Step 5: Commit**

```bash
git add BlitztextMac/Features/Settings/HotkeyRecorderRow.swift BlitztextMac/Features/Settings/SettingsContentView.swift BlitztextMac/BlitztextMac.xcodeproj
git commit -m "Update: Tastenkuerzel in den Einstellungen aufnehmen und zuruecksetzen"
```

---

### Task 5: Anzeigen umstellen und `hotkeyLabel` entfernen

**Files:**
- Modify: `BlitztextMac/Features/Workflows/WorkflowType.swift` (`hotkeyLabel` loeschen)
- Modify: `BlitztextMac/Features/MenuBar/WorkflowRowView.swift:3-9` und `:42`
- Modify: `BlitztextMac/Features/MenuBar/MenuBarView.swift:105-112`
- Modify: `BlitztextMac/Features/Settings/SettingsContentView.swift:1054` (Diktat-Hinweis)

**Interfaces:**
- Consumes: `AppState.hotkeyLabel(for:)` aus Task 3.
- Produces: `WorkflowRowView` mit dem neuen Parameter `hotkeyLabel: String`.

- [ ] **Step 1: `hotkeyLabel` aus `WorkflowType` entfernen**

In `BlitztextMac/Features/Workflows/WorkflowType.swift` die gesamte Eigenschaft loeschen:

```swift
    var hotkeyLabel: String {
        switch self {
        case .transcription: return "fn + Shift"
        case .localTranscription: return "fn + Shift + Ctrl"
        case .vaultDictation: return "fn + Shift + Option"
        case .textImprover: return "fn + Control"
        case .dampfAblassen: return "fn + Option"
        case .emojiText: return "fn + Cmd"
        }
    }
```

- [ ] **Step 2: `WorkflowRowView` bekommt das Label von aussen**

In `BlitztextMac/Features/MenuBar/WorkflowRowView.swift` den Eigenschaftsblock erweitern:

```swift
struct WorkflowRowView: View {
    let type: WorkflowType
    let enabled: Bool
    let hotkeyLabel: String
    var customName: String? = nil
    var subtitle: String? = nil
    let action: () -> Void
```

und die Badge-Zeile anpassen:

```swift
                // Hotkey badge
                HotkeyBadge(label: hotkeyLabel, enabled: enabled)
                    .opacity(enabled ? 1 : 0.4)
```

- [ ] **Step 3: Aufrufstelle in `MenuBarView` anpassen**

In `BlitztextMac/Features/MenuBar/MenuBarView.swift` den Aufruf ergaenzen:

```swift
                    WorkflowRowView(
                        type: type,
                        enabled: enabled,
                        hotkeyLabel: appState.hotkeyLabel(for: type),
                        customName: appState.displayName(for: type),
                        subtitle: appState.workflowSubtitle(for: type)
                    ) {
                        appState.startWorkflow(type)
                    }
```

- [ ] **Step 4: Diktat-Hinweis auf das aktuelle Kuerzel umstellen**

In `BlitztextMac/Features/Settings/SettingsContentView.swift` im Abschnitt Diktat die feste Zeile

```swift
                Text("fn + Shift + Option h\u{00E4}lt einen Gedanken in einer Tagesdatei fest, statt ihn am Cursor einzusetzen.")
```

ersetzen durch

```swift
                Text("\(appState.hotkeyLabel(for: .vaultDictation)) h\u{00E4}lt einen Gedanken in einer Tagesdatei fest, statt ihn am Cursor einzusetzen.")
```

- [ ] **Step 5: Sicherstellen, dass kein festes Kuerzel mehr im Code steht**

Run: `grep -rn "hotkeyLabel\|fn + " --include="*.swift" BlitztextMac`
Expected: Treffer nur noch fuer `AppState.hotkeyLabel(for:)`, dessen Aufrufe, den Parameter in `WorkflowRowView`, den Hinweistext im Abschnitt Tastenkuerzel und die Testdatei `HotkeyBindingsTests.swift`. Keine `switch`-Liste mit festen Kuerzeln mehr.

- [ ] **Step 6: Tests und Bau**

Run: `./test.sh`
Expected: PASS.

Run: `./build.sh --debug --run`

Zu pruefen:

1. Die Badges in der Menueleisten-Liste zeigen die tatsaechlich vergebenen Kuerzel, auch nach einer Aenderung in den Einstellungen.
2. Der Hinweis im Abschnitt Diktat nennt das aktuelle Kuerzel von Blitztext Notiz.
3. Ein geaendertes Kuerzel wirkt sofort, ohne Neustart der App.

- [ ] **Step 7: Commit**

```bash
git add BlitztextMac/Features/Workflows/WorkflowType.swift BlitztextMac/Features/MenuBar/WorkflowRowView.swift BlitztextMac/Features/MenuBar/MenuBarView.swift BlitztextMac/Features/Settings/SettingsContentView.swift
git commit -m "Update: Anzeigen zeigen die tatsaechlich vergebenen Tastenkuerzel"
```

---

## Abschluss

- [ ] `./test.sh` laeuft vollstaendig gruen.
- [ ] `./build.sh --debug --run` startet, alle sechs Kuerzel funktionieren im Halten- und im Druecken-Modus.
- [ ] Eine bestehende Installation ohne den Schluessel `hotkeyBindings` in der Einstellungsdatei startet mit den bisherigen Kuerzeln. Pruefbar, indem der Schluessel aus `~/Library/Application Support/Blitztext/settings.json` entfernt wird, bevor die App startet. Den genauen Pfad liefert `AppSupportPaths.settingsURL`.
- [ ] `git log --oneline` zeigt fuenf Commits im Stil des Repositories.
