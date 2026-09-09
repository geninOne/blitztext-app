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
