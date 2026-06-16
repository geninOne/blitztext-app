import Foundation

enum TranscriptionError: LocalizedError {
    case noFile
    case notConfigured
    case networkError(String)
    case apiError(String)

    var errorDescription: String? {
        switch self {
        case .noFile:
            return "Keine Audio-Datei gefunden"
        case .notConfigured:
            return "API Key fehlt. Bitte in den Einstellungen hinterlegen."
        case .networkError(let msg):
            return "Netzwerkfehler: \(msg)"
        case .apiError(let msg):
            return "Server-Fehler: \(msg)"
        }
    }
}

private struct TranscriptionOpenAIErrorResponse: Decodable {
    struct APIError: Decodable {
        let message: String?
    }

    let error: APIError?
}

enum TranscriptionService {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 60
        return URLSession(configuration: configuration)
    }()

    static func transcribe(
        audioURL: URL,
        customTerms: [String] = [],
        language: String? = nil,
        config: APIConfiguration
    ) async throws -> String {
        let apiKey = config.apiKey
        let transcriptionsURL = config.transcriptionsURL
        let remoteModel = config.transcriptionModel

        return try await Task.detached(priority: .userInitiated) {
            defer {
                try? FileManager.default.removeItem(at: audioURL)
            }

            let boundary = UUID().uuidString
            var request = URLRequest(url: transcriptionsURL)
            request.httpMethod = "POST"
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            request.setValue("text/plain, application/json", forHTTPHeaderField: "Accept")
            request.timeoutInterval = 60
            request.cachePolicy = .reloadIgnoringLocalCacheData

            let audioData = try Data(contentsOf: audioURL, options: [.mappedIfSafe])

            var body = Data()
            body.append("--\(boundary)\r\n")
            body.append("Content-Disposition: form-data; name=\"file\"; filename=\"audio.m4a\"\r\n")
            body.append("Content-Type: audio/m4a\r\n\r\n")
            body.append(audioData)
            body.append("\r\n")

            body.append("--\(boundary)\r\n")
            body.append("Content-Disposition: form-data; name=\"model\"\r\n\r\n")
            body.append(remoteModel)
            body.append("\r\n")

            body.append("--\(boundary)\r\n")
            body.append("Content-Disposition: form-data; name=\"response_format\"\r\n\r\n")
            body.append("text")
            body.append("\r\n")

            if !customTerms.isEmpty {
                let prompt = "Eigennamen und Begriffe: \(customTerms.joined(separator: ", "))"
                body.append("--\(boundary)\r\n")
                body.append("Content-Disposition: form-data; name=\"prompt\"\r\n\r\n")
                body.append(prompt)
                body.append("\r\n")
            }

            if let language, !language.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                body.append("--\(boundary)\r\n")
                body.append("Content-Disposition: form-data; name=\"language\"\r\n\r\n")
                body.append(language.trimmingCharacters(in: .whitespacesAndNewlines))
                body.append("\r\n")
            }

            body.append("--\(boundary)--\r\n")
            request.httpBody = body

            let lang = (language?.trimmingCharacters(in: .whitespacesAndNewlines))
                .flatMap { $0.isEmpty ? nil : $0 } ?? "auto"
            let requestSummary = "Audio · Modell \(remoteModel) · Sprache \(lang)"
            func log(success: Bool, status: Int?, response: String) {
                APILog.record(
                    task: "Transkription",
                    model: remoteModel,
                    endpoint: transcriptionsURL,
                    success: success,
                    status: status,
                    request: requestSummary,
                    response: response
                )
            }

            let data: Data
            let response: URLResponse
            do {
                (data, response) = try await session.data(for: request)
            } catch {
                log(success: false, status: nil, response: "Netzwerkfehler: \(error.localizedDescription)")
                throw error
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                log(success: false, status: nil, response: "Ungueltige Antwort")
                throw TranscriptionError.networkError("Ungueltige Antwort")
            }

            guard httpResponse.statusCode == 200 else {
                let detail = openAIErrorMessage(from: data) ?? APILog.bodyPreview(data) ?? "Status \(httpResponse.statusCode)"
                log(success: false, status: httpResponse.statusCode, response: detail)
                throw TranscriptionError.apiError(openAIErrorMessage(from: data) ?? "Status \(httpResponse.statusCode)")
            }

            let rawBody = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

            // LiteLLM and some other OpenAI-compatible gateways return a JSON
            // object ({"text": "..."}) even when response_format=text is
            // requested. Prefer the JSON `text` field; fall back to the raw
            // body for endpoints that honour plain-text responses.
            let transcript = transcriptText(fromJSON: data) ?? rawBody

            guard !transcript.isEmpty else {
                log(success: false, status: 200, response: "Leere Transkription")
                throw TranscriptionError.apiError("Transkription fehlgeschlagen")
            }

            log(success: true, status: 200, response: transcript)
            return transcript
        }.value
    }

    private struct TranscriptionTextResponse: Decodable {
        let text: String?
    }

    private static func transcriptText(fromJSON data: Data) -> String? {
        guard let decoded = try? JSONDecoder().decode(TranscriptionTextResponse.self, from: data),
              let text = decoded.text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else {
            return nil
        }
        return text
    }

    private static func openAIErrorMessage(from data: Data) -> String? {
        (try? JSONDecoder().decode(TranscriptionOpenAIErrorResponse.self, from: data))?.error?.message
    }
}

private extension Data {
    mutating func append(_ string: String) {
        if let data = string.data(using: .utf8) {
            append(data)
        }
    }
}
