import Foundation
import Observation

/// One recorded remote request: what was sent and what came back.
struct APILogEntry: Identifiable, Sendable {
    let id = UUID()
    let date: Date
    let task: String
    let model: String
    let host: String
    let success: Bool
    let statusText: String
    let request: String
    let response: String
}

/// In-memory, newest-first history of remote requests, shown in Settings.
/// Lives only for the current app session (not persisted to disk) and is
/// capped to keep memory bounded. Mutated on the main actor only.
@Observable
final class APILogStore {
    @MainActor static let shared = APILogStore()

    private(set) var entries: [APILogEntry] = []
    private let maxEntries = 50

    @MainActor
    func add(_ entry: APILogEntry) {
        entries.insert(entry, at: 0)
        if entries.count > maxEntries {
            entries.removeLast(entries.count - maxEntries)
        }
    }

    @MainActor
    func clear() {
        entries.removeAll()
    }
}

/// Stateless helper the network services call to append a log entry. Safe to
/// call from any context; it hops to the main actor to record.
enum APILog {
    private static let previewLimit = 1200

    static func record(
        task: String,
        model: String,
        endpoint: URL,
        success: Bool,
        status: Int?,
        request: String,
        response: String
    ) {
        let entry = APILogEntry(
            date: Date(),
            task: task,
            model: model,
            host: endpoint.host ?? endpoint.absoluteString,
            success: success,
            statusText: status.map { "HTTP \($0)" } ?? (success ? "OK" : "Fehler"),
            request: String(request.prefix(previewLimit)),
            response: String(response.prefix(previewLimit))
        )
        Task { @MainActor in
            APILogStore.shared.add(entry)
        }
    }

    /// Raw UTF-8 body, trimmed, for surfacing unexpected/error responses.
    static func bodyPreview(_ data: Data) -> String? {
        guard let text = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else {
            return nil
        }
        return text
    }
}
