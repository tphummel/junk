/// One step of a streamed response.
public struct GenerationUpdate: Equatable, Sendable {
    /// The full response text so far, not a delta.
    public var text: String
    public var inputTokens: Int?
    public var outputTokens: Int?

    public init(text: String, inputTokens: Int? = nil, outputTokens: Int? = nil) {
        self.text = text
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
    }
}

/// Something that can stream a text response. The app uses `SystemTextGenerator`; tests supply a scripted one.
public protocol TextGenerator: Sendable {
    func generate(_ request: RunRequest) -> AsyncThrowingStream<GenerationUpdate, any Error>
    /// Load model resources ahead of the first request. Optional.
    func prewarm()
}

extension TextGenerator {
    public func prewarm() {}
}

/// Runs requests against a generator and measures them.
public struct InferenceRunner: Sendable {
    private let generator: any TextGenerator
    private let now: @Sendable () -> ContinuousClock.Instant

    public init(
        generator: any TextGenerator,
        now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now }
    ) {
        self.generator = generator
        self.now = now
    }

    public func prewarm() {
        generator.prewarm()
    }

    /// Streams snapshots, then a single `.finished` carrying the result and metrics.
    /// Cancelling the consuming task cancels generation.
    public func run(_ request: RunRequest) -> AsyncThrowingStream<RunEvent, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                let start = now()
                var timeToFirstText: Duration?
                var last = GenerationUpdate(text: "")
                do {
                    for try await update in generator.generate(request) {
                        if timeToFirstText == nil, !update.text.isEmpty {
                            timeToFirstText = start.duration(to: now())
                        }
                        last = update
                        continuation.yield(.snapshot(update.text))
                    }
                    try Task.checkCancellation()
                    let metrics = RunMetrics(
                        timeToFirstText: timeToFirstText,
                        duration: start.duration(to: now()),
                        inputTokens: last.inputTokens,
                        outputTokens: last.outputTokens
                    )
                    continuation.yield(.finished(RunResult(output: last.text, metrics: metrics)))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
