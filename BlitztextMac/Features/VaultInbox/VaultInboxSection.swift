import AppKit
import SwiftUI

/// Einstellungen der Vault-Inbox: welcher eigene Modus in die Tagesdatei
/// schreibt, wohin, und was mit liegengebliebenen Diktaten ist.
///
/// Eine Ergaenzung dieses Forks. Eigene Datei, damit das Originalprojekt in
/// SettingsContentView nur eine Zeile beruehrt.
struct VaultInboxSection: View {
    @Bindable var appState: AppState

    private var modes: [CustomMode] { appState.appSettings.customModes }

    private var selectedModeID: Binding<String> {
        Binding(
            get: { appState.dictationSettings.vaultModeID },
            set: { neu in
                appState.dictationSettings.vaultModeID = neu
                guard !neu.isEmpty else { return }
                Task { await UserNotificationService.requestAuthorizationIfNeeded() }
                appState.refreshNotificationPermission()
            }
        )
    }

    var body: some View {
        SettingsSection(title: "Diktat in die Inbox") {
            Text("Ein eigener Modus kann sein Diktat in einer Tagesdatei festhalten, statt es am Cursor einzusetzen. Ein Modus ohne Anweisung schreibt wortgenau mit.")
                .font(.ui(12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if modes.isEmpty {
                Text("Noch kein eigener Modus angelegt. Unter \u{201E}Eigene Modi\u{201C} einen anlegen, die Anweisung leer lassen und ihn hier w\u{00E4}hlen.")
                    .font(.ui(12))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(spacing: 8) {
                    Text("Modus")
                        .font(.ui(11.5, .medium))
                    Spacer(minLength: 6)
                    Picker("", selection: selectedModeID) {
                        Text("Keiner").tag("")
                        ForEach(modes) { mode in
                            Text(WorkflowType.customName(mode)).tag(mode.id)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                    .fixedSize()
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Ablageordner")
                    .font(.ui(11.5))
                    .foregroundStyle(.secondary)

                HStack(spacing: 8) {
                    Text(appState.vaultFolderConfigured
                         ? appState.dictationSettings.vaultFolderPath
                         : "Kein Ordner gew\u{00E4}hlt")
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(appState.vaultFolderConfigured ? .primary : .secondary)
                        .lineLimit(1)
                        .truncationMode(.head)
                    Spacer(minLength: 6)
                    Button("Ordner w\u{00E4}hlen") {
                        chooseVaultFolder()
                    }
                    .font(.ui(11.5))
                }
            }

            if !appState.dictationSettings.vaultModeID.isEmpty, !appState.vaultFolderConfigured {
                hinweis(
                    symbol: "exclamationmark.triangle.fill",
                    farbe: BlitztextTheme.danger,
                    text: "Ohne Ablageordner kann dieser Modus nichts schreiben. Das Diktat landet dann in der Warteschlange."
                )
            }

            Toggle("Second-Brain-Frontmatter schreiben", isOn: $appState.dictationSettings.writesSecondBrainFrontmatter)
                .toggleStyle(.switch)
                .font(.ui(11.5))

            if appState.dictationSettings.writesSecondBrainFrontmatter {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Sph\u{00E4}re")
                        .font(.ui(11.5))
                        .foregroundStyle(.secondary)

                    Picker("", selection: $appState.dictationSettings.sphere) {
                        ForEach(DictationSphere.allCases) { sphere in
                            Text(sphere.displayName).tag(sphere)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                }
            }

            if appState.dictationQueueCount > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.ui(11, .semibold))
                        .foregroundStyle(BlitztextTheme.danger)
                    Text(appState.dictationQueueCount == 1
                         ? "1 Diktat wartet auf die Ablage."
                         : "\(appState.dictationQueueCount) Diktate warten auf die Ablage.")
                        .font(.ui(11.5))
                    Spacer(minLength: 6)
                    Button("Jetzt nachziehen") {
                        appState.flushDictationQueue()
                    }
                    .font(.ui(11.5))
                }
            }

            if let issue = appState.dictationQueueIssue {
                hinweis(
                    symbol: "info.circle.fill",
                    farbe: .secondary,
                    text: "Letzter Versuch abgebrochen: \(issue)"
                )
            }

            if appState.notificationsDenied {
                hinweis(
                    symbol: "bell.slash.fill",
                    farbe: .secondary,
                    text: "Benachrichtigungen sind aus. Die Best\u{00E4}tigung erscheint dann nur im Men\u{00FC}leisten-Symbol."
                )
            }
        }
        .task {
            appState.refreshDictationQueueCount()
            appState.refreshNotificationPermission()
        }
    }

    private func hinweis(symbol: String, farbe: Color, text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: symbol)
                .font(.ui(11, .semibold))
                .foregroundStyle(farbe)
            Text(text)
                .font(.ui(11.5))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func chooseVaultFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Ausw\u{00E4}hlen"
        panel.message = "Ordner f\u{00FC}r die Diktat-Tagesdateien w\u{00E4}hlen"

        if appState.vaultFolderConfigured {
            panel.directoryURL = URL(fileURLWithPath: appState.dictationSettings.vaultFolderPath)
        }

        guard panel.runModal() == .OK, let url = panel.url else { return }
        appState.setVaultFolder(url)
        appState.flushDictationQueue()
    }
}
