import AppKit
import Observation

/// Nimmt eine Modifier-Kombination auf. Gemerkt wird die groesste gleichzeitig
/// gehaltene Menge (bei gleicher Groesse gewinnt die zuletzt gehaltene),
/// uebernommen wird sie beim Loslassen aller Modifier.
@Observable
@MainActor
final class HotkeyRecorder {
    private(set) var groessteKombination = HotkeyCombo([])
    private(set) var laeuft = false

    private var monitore: [Any] = []
    private var onCommit: ((HotkeyCombo) -> Void)?
    private var onCancel: (() -> Void)?

    /// Setzt die Handler, leert den Kandidaten und setzt laeuft auf true,
    /// ohne Monitore zu registrieren. Von start(onCommit:onCancel:) benutzt,
    /// und direkt von Tests, die verarbeite(flags:) selbst fuettern.
    func arm(onCommit: @escaping (HotkeyCombo) -> Void, onCancel: @escaping () -> Void) {
        self.onCommit = onCommit
        self.onCancel = onCancel
        groessteKombination = HotkeyCombo([])
        laeuft = true
    }

    func start(onCommit: @escaping (HotkeyCombo) -> Void, onCancel: @escaping () -> Void) {
        stopMonitore()
        arm(onCommit: onCommit, onCancel: onCancel)

        let lokal = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            guard let self, self.laeuft else { return event }
            let flags = event.modifierFlags
            Task { @MainActor in
                self.verarbeite(flags: flags)
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
            guard let self, self.laeuft else { return event }
            guard event.keyCode == 53 else { return event }
            Task { @MainActor in
                self.abbrechen()
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

    func verarbeite(flags: NSEvent.ModifierFlags) {
        guard laeuft else { return }
        let kombination = HotkeyCombo(flags: flags)

        guard kombination.isEmpty else {
            // Bei gleicher Groesse gewinnt die zuletzt gehaltene Menge: eine
            // kleinere Teilmenge beim Loslassen wird bewusst ignoriert, damit
            // das Aufbauen einer laengeren Kombination funktioniert (erst
            // fn, dann fn+Shift und so weiter).
            if kombination.modifiers.count >= groessteKombination.modifiers.count {
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
