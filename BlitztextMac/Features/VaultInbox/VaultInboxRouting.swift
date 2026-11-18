import Foundation

// Die Vault-Inbox ist eine Ergaenzung dieses Forks. Alles, was sie braucht und
// was nicht in einer ohnehin eigenen Datei steht, liegt hier, damit kuenftige
// Merges mit dem Originalprojekt moeglichst wenig Beruehrung haben.

extension AppSupportPaths {
    /// Diktate, die nicht geschrieben werden konnten, warten hier.
    static var dictationQueueURL: URL {
        appSupportDirectoryURL.appendingPathComponent("dictation-queue.json")
    }
}

/// Entscheidet, wohin ein fertiges Diktat geht.
enum VaultInboxRouting {
    /// Wahr, wenn dieser Modus in die Tagesdatei schreibt statt an den Cursor.
    ///
    /// Gekoppelt wird ueber die `id` eines eigenen Modus. Ein eigener Modus
    /// ohne Anweisung transkribiert wortgenau, genau wie der fruehere
    /// Workflow "Blitztext Notiz".
    static func writesToVault(_ type: WorkflowType?, settings: DictationSettings) -> Bool {
        guard let modeID = type?.customModeID else { return false }
        let gewaehlt = settings.vaultModeID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !gewaehlt.isEmpty else { return false }
        return modeID == gewaehlt
    }

    /// Wahr, wenn ein Ablageordner eingestellt ist.
    static func folderConfigured(_ settings: DictationSettings) -> Bool {
        !settings.vaultFolderPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
