import Foundation

/// Resolved configuration for a single remote request.
///
/// Both OpenAI and a LiteLLM gateway speak the same OpenAI-compatible protocol,
/// so the only things that differ per provider are the base URL, the API key and
/// the model names. This struct carries exactly those, fully resolved, so the
/// network services stay provider-agnostic.
struct APIConfiguration: Sendable {
    let baseURL: URL
    let apiKey: String
    let fastModel: String
    let strongModel: String
    let transcriptionModel: String
    /// Whether to send a custom `temperature` on chat requests. Off for
    /// gateways, because some routed models (e.g. GPT-5 family) reject any
    /// non-default temperature and fail the whole request.
    let sendsTemperature: Bool

    var chatCompletionsURL: URL {
        baseURL.appendingPathComponent("v1/chat/completions")
    }

    var transcriptionsURL: URL {
        baseURL.appendingPathComponent("v1/audio/transcriptions")
    }

    /// Builds the active configuration from the persisted settings and the
    /// stored credentials. Returns `nil` when the selected provider is not yet
    /// fully configured (missing key, or missing gateway URL for LiteLLM).
    static func resolve(settings: AppSettings) -> APIConfiguration? {
        switch settings.apiProvider {
        case .openAI:
            guard let key = KeychainService.load(key: .openAIAPIKey), !key.isEmpty else {
                return nil
            }
            return APIConfiguration(
                baseURL: URL(string: "https://api.openai.com")!,
                apiKey: key,
                fastModel: "gpt-4o-mini",
                strongModel: "gpt-4o",
                transcriptionModel: "whisper-1",
                sendsTemperature: true
            )

        case .liteLLM:
            guard let key = KeychainService.load(key: .liteLLMAPIKey), !key.isEmpty,
                  let baseURL = normalizedBaseURL(settings.liteLLMBaseURL) else {
                return nil
            }
            return APIConfiguration(
                baseURL: baseURL,
                apiKey: key,
                fastModel: nonEmpty(settings.liteLLMFastModel, fallback: "gpt-4o-mini"),
                strongModel: nonEmpty(settings.liteLLMStrongModel, fallback: "gpt-4o"),
                transcriptionModel: nonEmpty(settings.liteLLMTranscriptionModel, fallback: "whisper-1"),
                sendsTemperature: false
            )
        }
    }

    /// Normalises a user-entered base URL: trims whitespace, drops a trailing
    /// slash and a trailing `/v1` (we append the API path ourselves), and
    /// requires an explicit http/https scheme and host.
    static func normalizedBaseURL(_ raw: String) -> URL? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        while value.hasSuffix("/") { value.removeLast() }
        if value.lowercased().hasSuffix("/v1") {
            value.removeLast(3)
            while value.hasSuffix("/") { value.removeLast() }
        }

        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else {
            return nil
        }
        return url
    }

    private static func nonEmpty(_ value: String, fallback: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : trimmed
    }
}
