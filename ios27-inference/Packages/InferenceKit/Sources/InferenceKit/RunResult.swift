/// Timings and token counts for one run.
public struct RunMetrics: Codable, Equatable, Sendable {
    /// From starting the run to the first non-empty text. `nil` if no text arrived.
    public var timeToFirstText: Duration?
    /// From starting the run to the end of the response.
    public var duration: Duration
    public var inputTokens: Int?
    public var outputTokens: Int?

    public init(timeToFirstText: Duration?, duration: Duration, inputTokens: Int?, outputTokens: Int?) {
        self.timeToFirstText = timeToFirstText
        self.duration = duration
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
    }

    /// Output tokens divided by total duration. `nil` without a token count or a measurable duration.
    public var outputTokensPerSecond: Double? {
        guard let outputTokens, duration > .zero else { return nil }
        return Double(outputTokens) / duration.seconds
    }
}

public struct RunResult: Codable, Equatable, Sendable {
    public var output: String
    public var metrics: RunMetrics

    public init(output: String, metrics: RunMetrics) {
        self.output = output
        self.metrics = metrics
    }
}

/// What a run reports while it is in progress.
public enum RunEvent: Equatable, Sendable {
    /// The full response text so far.
    case snapshot(String)
    /// The run completed. Always the last event of a successful run.
    case finished(RunResult)
}

/// A run failure in terms a person can act on.
public struct RunFailure: Error, Equatable, Sendable {
    public var message: String
    public var suggestion: String?

    public init(message: String, suggestion: String? = nil) {
        self.message = message
        self.suggestion = suggestion
    }
}

extension Duration {
    var seconds: Double {
        Double(components.seconds) + Double(components.attoseconds) / 1e18
    }
}
