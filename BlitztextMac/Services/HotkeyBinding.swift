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

    /// Alle vergebenen Kombinationen, die laengste zuerst. Bei gleicher
    /// Groesse entscheidet der rawValue des Workflows, damit die Reihenfolge
    /// deterministisch ist.
    var assignments: [(type: WorkflowType, combo: HotkeyCombo)] {
        WorkflowType.allCases
            .map { (type: $0, combo: combo(for: $0)) }
            .sorted {
                if $0.combo.modifiers.count != $1.combo.modifiers.count {
                    return $0.combo.modifiers.count > $1.combo.modifiers.count
                }
                return $0.type.rawValue < $1.type.rawValue
            }
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

    /// Setzt eine Abweichung zurueck und kaskadiert: belegt ein anderer
    /// Workflow danach den Standard des zurueckgesetzten, wird auch er
    /// zurueckgesetzt, in einer Schleife, bis keine Doppelbelegung mehr
    /// besteht. Das terminiert, weil jeder Durchlauf eine Abweichung entfernt
    /// (eine endliche Menge) und die Standards selbst untereinander
    /// konfliktfrei sind, die Kaskade also nicht im Kreis laufen kann.
    mutating func reset(_ type: WorkflowType) {
        overrides[type] = nil
        var aktuellerTyp = type
        while let besitzer = owner(of: Self.defaultCombo(for: aktuellerTyp), excluding: aktuellerTyp) {
            overrides[besitzer] = nil
            aktuellerTyp = besitzer
        }
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
