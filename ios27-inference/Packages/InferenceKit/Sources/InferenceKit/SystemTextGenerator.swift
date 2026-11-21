import Foundation
import FoundationModels

/// Streams text from the system's on-device language model. Each request gets a fresh session.
public struct SystemTextGenerator: TextGenerator {
    public init() {}

    public func prewarm() {
        LanguageModelSession().prewarm()
    }

    public func generate(_ request: RunRequest) -> AsyncThrowingStream<GenerationUpdate, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let instructions = request.instructions.trimmingCharacters(in: .whitespacesAndNewlines)
                    let session = instructions.isEmpty
                        ? LanguageModelSession()
                        : LanguageModelSession(instructions: instructions)
                    let stream = session.streamResponse(to: request.prompt, options: GenerationOptions(request.options))
                    for try await snapshot in stream {
                        continuation.yield(
                            GenerationUpdate(
                                text: snapshot.content,
                                inputTokens: snapshot.usage.input.totalTokenCount,
                                outputTokens: snapshot.usage.output.totalTokenCount
                            )
                        )
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish(throwing: CancellationError())
                } catch {
                    continuation.finish(throwing: RunFailure(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

extension GenerationOptions {
    init(_ options: RunOptions) {
        self.init(
            samplingMode: options.sampling == .greedy ? .greedy : nil,
            temperature: options.temperature,
            maximumResponseTokens: options.maximumResponseTokens
        )
    }
}

extension RunFailure {
    init(_ error: any Error) {
        guard let generationError = error as? LanguageModelSession.GenerationError else {
            self.init(message: error.localizedDescription)
            return
        }
        switch generationError {
        case .exceededContextWindowSize:
            self.init(
                message: "The prompt and response did not fit in the model's context window.",
                suggestion: "Shorten the instructions or prompt, or lower the response limit."
            )
        case .guardrailViolation:
            self.init(
                message: "The system's safety guardrails blocked this request or its response.",
                suggestion: "Rephrase the prompt."
            )
        case .unsupportedLanguageOrLocale:
            self.init(
                message: "The model does not support the language of this request.",
                suggestion: "See the Status tab for the supported languages."
            )
        case .assetsUnavailable:
            self.init(
                message: "The model's assets are not available right now.",
                suggestion: "Check the Status tab; the model may still be downloading."
            )
        case .rateLimited:
            self.init(message: "The system is rate limiting requests.", suggestion: "Wait a moment and try again.")
        case .concurrentRequests:
            self.init(message: "The session was already handling another request.")
        default:
            self.init(message: generationError.localizedDescription)
        }
    }
}
