import Foundation
import Observation

/// One completed dictation: the recorded audio plus the recognized input and the
/// pasted output. A debug aid to hear the recording quality and check whether
/// speech was understood correctly.
struct DictationHistoryEntry: Identifiable, Sendable {
    let id = UUID()
    let date: Date
    let workflow: WorkflowType
    let input: String
    let output: String
    let audioURL: URL?
}

/// In-memory, newest-first history of the last few dictations. Lives only for
/// the current app session and keeps the audio files in a temp directory; older
/// entries (and their audio) are dropped past the cap. Main-actor only.
@Observable
final class DictationHistoryStore {
    @MainActor static let shared = DictationHistoryStore()

    private(set) var entries: [DictationHistoryEntry] = []
    private let maxEntries = 10
    private let directory: URL

    init() {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("blitztext-history", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Records a dictation. `audioData` is written into the session history
    /// directory so it survives the workflow deleting its own temp recording.
    @MainActor
    func record(
        workflow: WorkflowType,
        input: String,
        output: String,
        audioData: Data?,
        audioExtension: String
    ) {
        var storedURL: URL?
        if let audioData {
            let ext = audioExtension.isEmpty ? "m4a" : audioExtension
            let destination = directory.appendingPathComponent("\(UUID().uuidString).\(ext)")
            if (try? audioData.write(to: destination)) != nil {
                storedURL = destination
            }
        }

        let entry = DictationHistoryEntry(
            date: Date(),
            workflow: workflow,
            input: input,
            output: output,
            audioURL: storedURL
        )
        entries.insert(entry, at: 0)

        if entries.count > maxEntries {
            let dropped = entries[maxEntries...]
            for entry in dropped {
                if let url = entry.audioURL {
                    try? FileManager.default.removeItem(at: url)
                }
            }
            entries.removeLast(entries.count - maxEntries)
        }
    }

    @MainActor
    func clear() {
        for entry in entries {
            if let url = entry.audioURL {
                try? FileManager.default.removeItem(at: url)
            }
        }
        entries.removeAll()
    }
}

/// Called from a workflow's processing task right after producing output, while
/// the recording file still exists. Reads the audio bytes here (off the main
/// actor) and hands them to the store on the main actor.
func recordDictationHistory(workflow: WorkflowType, audioURL: URL, input: String, output: String) {
    let audioExtension = audioURL.pathExtension
    let audioData = try? Data(contentsOf: audioURL)
    Task { @MainActor in
        DictationHistoryStore.shared.record(
            workflow: workflow,
            input: input,
            output: output,
            audioData: audioData,
            audioExtension: audioExtension
        )
    }
}
