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
