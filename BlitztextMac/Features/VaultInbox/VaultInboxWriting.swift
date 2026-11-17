import Foundation

// Das Schreiben in die Tagesdatei, als Erweiterung von AppState. Liegt
// bewusst neben AppState statt darin: in AppState selbst stehen nur die
// gespeicherten Eigenschaften und der eine Abzweig im Ausgabeweg.

extension AppState {
    // MARK: - Diktat in den Vault

    /// Schreibt ein fertiges Diktat in die Tagesdatei. Bewusst ohne Einfuegen
    /// am Cursor: es darf kein Text in ein fremdes Fenster rutschen.
    func writeToVaultInbox(_ text: String, type: WorkflowType?) {
        let settings = dictationSettings
        let recordedAt = Date()

        Task { [weak self] in
            guard let self else { return }

            // Vor jedem neuen Schreiben nachziehen, damit die Reihenfolge
            // stimmt und liegengebliebene Gedanken nicht verhungern.
            let vorlauf = await self.dictationQueue.flush(
                using: self.vaultInboxService,
                settings: settings
            )
            self.dictationQueueIssue = vorlauf.stoppedBecause

            do {
                let ziel = try await self.vaultInboxService.append(
                    text: text,
                    recordedAt: recordedAt,
                    settings: settings
                )
                self.finishVaultWrite(
                    text: text,
                    fileName: ziel.lastPathComponent,
                    queueRemaining: vorlauf.remaining
                )
            } catch {
                await self.handleVaultWriteFailure(
                    text: text,
                    recordedAt: recordedAt,
                    reason: error.localizedDescription,
                    type: type
                )
            }
        }
    }

    private func finishVaultWrite(text: String, fileName: String, queueRemaining: Int) {
        dictationQueueCount = queueRemaining
        UserNotificationService.notifyDictationSaved(
            preview: text,
            fileName: fileName,
            olderPending: queueRemaining
        )
    }

    private func handleVaultWriteFailure(
        text: String,
        recordedAt: Date,
        reason: String,
        type: WorkflowType?
    ) async {
        // Zwischenablage zuerst: sie ist sofort greifbar, auch wenn das
        // Ablegen in die Warteschlange scheitert.
        copyToClipboard(text)
        menuBarStatus = .error(type, reason)

        do {
            try await dictationQueue.enqueue(
                QueuedDictation(recordedAt: recordedAt, text: text)
            )
            dictationQueueCount = (try? await dictationQueue.pending())?.count ?? dictationQueueCount
            UserNotificationService.notifyDictationFailed(reason: reason)
        } catch {
            // Auch die Warteschlange ist beschädigt: der Text steht dann
            // ausschließlich in der Zwischenablage, und genau das muss die
            // Meldung sagen, statt fälschlich "liegt in der Warteschlange"
            // zu suggerieren.
            UserNotificationService.notifyDictationFailed(
                reason: "\(reason) Auch das Ablegen in der Warteschlange ist fehlgeschlagen."
            )
        }
    }

    /// Zieht liegengebliebene Diktate nach. Aufgerufen beim Start und von der
    /// Schaltfläche in den Einstellungen.
    func flushDictationQueue() {
        let settings = dictationSettings
        Task { [weak self] in
            guard let self else { return }
            let ergebnis = await self.dictationQueue.flush(
                using: self.vaultInboxService,
                settings: settings
            )
            self.dictationQueueCount = ergebnis.remaining
            self.dictationQueueIssue = ergebnis.stoppedBecause
        }
    }

    func refreshDictationQueueCount() {
        Task { [weak self] in
            guard let self else { return }
            // Ist die Warteschlangendatei beschädigt, bleibt der letzte
            // bekannte Zähler stehen. Ein stilles 0 wäre die falsche
            // Auskunft, denn die Einträge sind ja noch da.
            if let offen = try? await self.dictationQueue.pending() {
                self.dictationQueueCount = offen.count
            }
        }
    }

    func refreshNotificationPermission() {
        Task { [weak self] in
            guard let self else { return }
            self.notificationsDenied = await UserNotificationService.authorizationDenied()
        }
    }

    func setVaultFolder(_ url: URL) {
        dictationSettings.vaultFolderPath = url.path
    }

    var vaultFolderConfigured: Bool {
        VaultInboxRouting.folderConfigured(dictationSettings)
    }

    /// Der eigene Modus, der in die Tagesdatei schreibt, sofern es ihn noch gibt.
    var vaultMode: CustomMode? {
        let id = dictationSettings.vaultModeID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return nil }
        return appSettings.customMode(id: id)
    }
}
