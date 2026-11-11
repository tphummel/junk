/// Everything needed to reproduce one run. `Codable` so runs can be saved and exported.
public struct RunRequest: Codable, Equatable, Sendable {
    /// System-style guidance for the session. Empty means none.
    public var instructions: String
    public var prompt: String
    public var options: RunOptions

    public init(instructions: String = "", prompt: String, options: RunOptions = RunOptions()) {
        self.instructions = instructions
        self.prompt = prompt
        self.options = options
    }
}

/// Generation settings. `nil` leaves the choice to the system.
public struct RunOptions: Codable, Equatable, Sendable {
    public enum Sampling: String, Codable, CaseIterable, Sendable {
        /// The system's default sampling.
        case automatic
        /// Always pick the most likely token, for repeatable output.
        case greedy
    }

    public var temperature: Double?
    public var maximumResponseTokens: Int?
    public var sampling: Sampling

    public init(temperature: Double? = nil, maximumResponseTokens: Int? = nil, sampling: Sampling = .automatic) {
        self.temperature = temperature
        self.maximumResponseTokens = maximumResponseTokens
        self.sampling = sampling
    }
}
