/// Whether the on-device model can be used right now.
public enum ModelAvailability: Equatable, Sendable {
    case available
    case unavailable(UnavailableReason)

    public enum UnavailableReason: Equatable, Sendable {
        /// The hardware does not support Apple Intelligence.
        case deviceNotEligible
        /// Apple Intelligence is switched off in Settings.
        case appleIntelligenceNotEnabled
        /// The model is still downloading or otherwise not ready.
        case modelNotReady
        /// A reason this version of the toolkit does not know about.
        case other(String)
    }

    public var isAvailable: Bool { self == .available }

    /// Short label, e.g. for a status row.
    public var title: String {
        switch self {
        case .available: "Available"
        case .unavailable(.deviceNotEligible): "Device not eligible"
        case .unavailable(.appleIntelligenceNotEnabled): "Apple Intelligence is off"
        case .unavailable(.modelNotReady): "Model not ready"
        case .unavailable(.other): "Unavailable"
        }
    }

    /// What the state means and what to do about it.
    public var explanation: String {
        switch self {
        case .available:
            "The on-device model is ready to use."
        case .unavailable(.deviceNotEligible):
            "This device does not support Apple Intelligence, so the on-device model cannot run here."
        case .unavailable(.appleIntelligenceNotEnabled):
            "Turn on Apple Intelligence in Settings, under Apple Intelligence & Siri, then come back."
        case .unavailable(.modelNotReady):
            "The model is not ready yet. It may still be downloading; keep the device on Wi-Fi and power and check again later."
        case .unavailable(.other(let detail)):
            "The system reported a reason this app does not recognize: \(detail)"
        }
    }

    /// True when the fix is a switch in the Settings app.
    public var isFixableInSettings: Bool {
        self == .unavailable(.appleIntelligenceNotEnabled)
    }
}

/// A snapshot of what the on-device model reports about itself.
public struct ModelStatus: Equatable, Sendable {
    public var availability: ModelAvailability
    /// Context window in tokens.
    public var contextSize: Int
    /// BCP 47 identifiers of the languages the model supports, sorted.
    public var supportedLanguages: [String]

    public init(availability: ModelAvailability, contextSize: Int, supportedLanguages: [String]) {
        self.availability = availability
        self.contextSize = contextSize
        self.supportedLanguages = supportedLanguages
    }
}

/// Source of `ModelStatus`. The app uses `SystemModelCatalog`; tests supply a fixed one.
public protocol ModelCatalog: Sendable {
    func currentStatus() -> ModelStatus
}
