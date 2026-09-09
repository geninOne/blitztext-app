import SwiftUI
import AppKit

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
            // Bei gleicher Groesse gewinnt die zuletzt gehaltene Menge, sonst
            // bliebe eine Menge stehen, deren Tasten nicht mehr gedrueckt sind.
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
