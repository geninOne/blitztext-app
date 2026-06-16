import Foundation

enum LLMError: LocalizedError {
    case notConfigured
    case networkError(String)
    case apiError(String)
    case noContent

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "API Key fehlt. Bitte in den Einstellungen hinterlegen."
        case .networkError(let msg):
            return "Verbindungsproblem: \(msg)"
        case .apiError(let msg):
            return "Fehler vom Server: \(msg)"
        case .noContent:
            return "Keine Antwort erhalten. Bitte nochmal versuchen."
        }
    }
}

private struct OpenAIChatRequest: Encodable {
    struct Message: Encodable {
        let role: String
        let content: String
    }

    let model: String
    let messages: [Message]
    let temperature: Double?

    enum CodingKeys: String, CodingKey {
        case model
        case messages
        case temperature
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(model, forKey: .model)
        try container.encode(messages, forKey: .messages)
        // Omitted entirely when nil; some models reject a non-default temperature.
        try container.encodeIfPresent(temperature, forKey: .temperature)
    }
}

private struct OpenAIChatResponse: Decodable {
    struct Choice: Decodable {
        struct Message: Decodable {
            let content: String?
        }

        let message: Message?
    }

    let choices: [Choice]?
}

private struct OpenAIErrorResponse: Decodable {
    struct APIError: Decodable {
        let message: String?
    }

    let error: APIError?
}

enum LLMService {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 45
        configuration.timeoutIntervalForResource = 45
        return URLSession(configuration: configuration)
    }()

    static func improve(
        text: String,
        settings: TextImprovementSettings,
        config: APIConfiguration
    ) async throws -> String {
        try await complete(
            text: text,
            systemPrompt: buildSystemPrompt(settings: settings),
            model: config.fastModel,
            temperature: 0.3,
            task: "Text verbessern",
            config: config
        )
    }

    static func dampfAblassen(
        text: String,
        systemPrompt: String,
        config: APIConfiguration
    ) async throws -> String {
        try await complete(
            text: text,
            systemPrompt: systemPrompt,
            model: config.strongModel,
            temperature: 0.4,
            task: "Dampf ablassen",
            config: config
        )
    }

    static func addEmojis(
        text: String,
        settings: EmojiTextSettings,
        config: APIConfiguration
    ) async throws -> String {
        try await complete(
            text: text,
            systemPrompt: buildEmojiSystemPrompt(density: settings.emojiDensity),
            model: config.fastModel,
            temperature: 0.3,
            task: "Emojis",
            config: config
        )
    }

    private static func complete(
        text: String,
        systemPrompt: String,
        model: String,
        temperature: Double,
        task: String,
        config: APIConfiguration
    ) async throws -> String {
        let endpoint = config.chatCompletionsURL
        let payload = OpenAIChatRequest(
            model: model,
            messages: [
                .init(role: "system", content: systemPrompt),
                .init(role: "user", content: text),
            ],
            temperature: config.sendsTemperature ? temperature : nil
        )

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 45
        request.httpBody = try JSONEncoder().encode(payload)

        func log(success: Bool, status: Int?, response: String) {
            APILog.record(
                task: task,
                model: model,
                endpoint: endpoint,
                success: success,
                status: status,
                request: text,
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
            log(success: false, status: nil, response: "Keine gültige Antwort")
            throw LLMError.networkError("Keine gültige Antwort")
        }

        guard httpResponse.statusCode == 200 else {
            let detail = openAIErrorMessage(from: data) ?? APILog.bodyPreview(data) ?? "Status \(httpResponse.statusCode)"
            log(success: false, status: httpResponse.statusCode, response: detail)
            throw LLMError.apiError(openAIErrorMessage(from: data) ?? "Status \(httpResponse.statusCode)")
        }

        let result: OpenAIChatResponse
        do {
            result = try JSONDecoder().decode(OpenAIChatResponse.self, from: data)
        } catch {
            log(success: false, status: 200, response: APILog.bodyPreview(data) ?? "Antwort nicht lesbar")
            throw LLMError.noContent
        }

        guard let content = result.choices?.first?.message?.content,
              !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            log(success: false, status: 200, response: APILog.bodyPreview(data) ?? "Keine Antwort im Body")
            throw LLMError.noContent
        }

        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        log(success: true, status: 200, response: trimmed)
        return trimmed
    }

    private static func openAIErrorMessage(from data: Data) -> String? {
        (try? JSONDecoder().decode(OpenAIErrorResponse.self, from: data))?.error?.message
    }

    private static func buildEmojiSystemPrompt(density: EmojiTextSettings.EmojiDensity) -> String {
        let densityInstruction: String
        switch density {
        case .wenig:
            densityInstruction = "Setze nur vereinzelt Emojis ein, maximal 1-2 pro Absatz."
        case .mittel:
            densityInstruction = "Setze regelmaessig passende Emojis ein, etwa alle 1-2 Saetze."
        case .viel:
            densityInstruction = "Setze grosszuegig Emojis ein, gerne mehrere pro Satz."
        }

        return "Du erhaeltst ein gesprochenes Transkript. Gib den Text moeglichst originalgetreu zurueck, aber fuege passende Emojis ein. \(densityInstruction) Korrigiere offensichtliche Sprach- und Grammatikfehler. Behalte den Stil und die Bedeutung bei. Gib NUR den Text mit Emojis zurueck, keine Erklaerungen."
    }

    private static func buildSystemPrompt(settings: TextImprovementSettings) -> String {
        if !settings.systemPrompt.isEmpty {
            var prompt = settings.systemPrompt
            if !settings.customTerms.isEmpty {
                prompt += "\n\nWichtig: Diese Eigennamen und Fachbegriffe muessen exakt so geschrieben werden: \(settings.customTerms.joined(separator: ", "))"
            }
            return prompt
        }

        var prompt = """
        Du bist ein Lektor und Schreibassistent. Verbessere den folgenden Text:
        - Korrigiere Rechtschreibung und Grammatik
        - Verbessere die Formulierung und den Lesefluss
        - Behalte die urspruengliche Bedeutung bei
        - Gib NUR den verbesserten Text zurueck, keine Erklaerungen
        """

        switch settings.tone {
        case .formal:
            prompt += "\n- Verwende einen formellen, professionellen Ton"
        case .neutral:
            prompt += "\n- Verwende einen neutralen, klaren Ton"
        case .casual:
            prompt += "\n- Verwende einen lockeren, natuerlichen Ton"
        }

        if !settings.customTerms.isEmpty {
            prompt += "\n\nWichtig: Diese Eigennamen und Fachbegriffe muessen exakt so geschrieben werden: \(settings.customTerms.joined(separator: ", "))"
        }

        if !settings.context.isEmpty {
            prompt += "\n\nKontext: \(settings.context)"
        }

        return prompt
    }
}
