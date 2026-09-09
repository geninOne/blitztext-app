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
    /// Die aktuell vergebenen Kuerzel. Wird vom AppState gesetzt, keine View
    /// liest sie direkt.
    @ObservationIgnored
    var bindings = HotkeyBindings()

    var onHotkeyEvent: ((HotkeyEvent) -> Void)?

    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var keyMonitor: Any?
    /// Kombination, die gerade gehalten wird.
    private var activeCombo: WorkflowType?
    /// Laufende Wartezeit fuer eine Praefix-Kombination.
    private var pendingTask: Task<Void, Never>?
    /// Kombination und Workflow der laufenden Wartezeit, damit eine
    /// Lockerung der Tasten die Entscheidung sofort fallen lassen kann.
    private var pendingCombo: HotkeyCombo?
    private var pendingType: WorkflowType?
    /// Die zuletzt in handleFlags gesehene Kombination. firePending prueft
    /// gegen diese und nicht gegen NSEvent.modifierFlags, damit Entscheidung
    /// und Nachpruefung dieselbe Wahrheitsquelle haben.
    private var lastSeenCombo = HotkeyCombo([])
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

        let combo = HotkeyCombo(flags: flags)
        lastSeenCombo = combo

        if let ausstehenderTyp = pendingType, let ausstehendeCombo = pendingCombo,
           !ausstehendeCombo.isStrictSubset(of: combo) {
            // Die Tasten wurden gelockert statt erweitert: die ausstehende
            // Entscheidung faellt jetzt, bevor die neuen Flags verarbeitet
            // werden. Sonst bliebe ein kurzer Tipp auf ein
            // Praefix-Kuerzel im Druecken-Modus wirkungslos.
            cancelPending()
            activeCombo = ausstehenderTyp
            onHotkeyEvent?(.down(ausstehenderTyp))
        } else {
            cancelPending()
        }

        switch HotkeyMatcher(bindings: bindings).decision(for: combo, active: activeCombo) {
        case .fire(let type):
            activeCombo = type
            onHotkeyEvent?(.down(type))

        case .delayed(let type, let delay):
            pendingCombo = combo
            pendingType = type
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
        pendingCombo = nil
        pendingType = nil
        guard !isSuspended, activeCombo == nil else { return }
        guard lastSeenCombo == combo else { return }
        activeCombo = type
        onHotkeyEvent?(.down(type))
    }

    private func cancelPending() {
        pendingTask?.cancel()
        pendingTask = nil
        pendingCombo = nil
        pendingType = nil
    }

    private func handleEscape() {
        guard !isSuspended else { return }
        cancelPending()
        activeCombo = nil
        onHotkeyEvent?(.cancel)
    }
}
