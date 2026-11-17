import Foundation

/// Sphäre der Tagesdatei. Vorgabe ist beruf, weil der Kanal im Arbeitsalltag
/// benutzt wird. Der Inbox-Sortierer korrigiert das je Abschnitt, wenn der
/// Inhalt privat ist. Blitztext soll das nicht erraten.
enum DictationSphere: String, Codable, CaseIterable, Identifiable {
    case beruf
    case privat

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .beruf: return "Beruf"
        case .privat: return "Privat"
        }
    }
}

/// Einstellungen des Diktat-Kanals. Der Zielordner ist bewusst leer
/// vorbelegt: ohne gesetzten Ordner ist der Workflow nicht verfügbar.
struct DictationSettings: Codable, Equatable {
    var vaultFolderPath: String = ""
    var writesSecondBrainFrontmatter: Bool = false
    var sphere: DictationSphere = .beruf
    /// Die `id` des eigenen Modus, dessen Diktate in die Tagesdatei gehen
    /// statt an den Cursor. Leer heisst: kein Modus schreibt in den Vault.
    ///
    /// Frueher war das ein eigener Workflow-Typ im Fork. Seit das
    /// Originalprojekt eigene Modi kennt, reicht ein Modus ohne Anweisung:
    /// er transkribiert wortgenau und bringt Name, Symbol und Kuerzel schon
    /// mit. So bleibt der Fork aus `WorkflowType` heraus.
    var vaultModeID: String = ""

    init(
        vaultFolderPath: String = "",
        writesSecondBrainFrontmatter: Bool = false,
        sphere: DictationSphere = .beruf,
        vaultModeID: String = ""
    ) {
        self.vaultFolderPath = vaultFolderPath
        self.writesSecondBrainFrontmatter = writesSecondBrainFrontmatter
        self.sphere = sphere
        self.vaultModeID = vaultModeID
    }

    enum CodingKeys: String, CodingKey {
        case vaultFolderPath
        case writesSecondBrainFrontmatter
        case sphere
        case vaultModeID
    }

    /// Jedes Feld über decodeIfPresent, damit eine bestehende settings.json
    /// ohne diesen Abschnitt weiter lädt. Gleiches Muster wie AppSettings.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        vaultFolderPath = try container.decodeIfPresent(String.self, forKey: .vaultFolderPath) ?? ""
        writesSecondBrainFrontmatter = try container.decodeIfPresent(
            Bool.self,
            forKey: .writesSecondBrainFrontmatter
        ) ?? false
        sphere = try container.decodeIfPresent(DictationSphere.self, forKey: .sphere) ?? .beruf
        vaultModeID = try container.decodeIfPresent(String.self, forKey: .vaultModeID) ?? ""
    }
}
