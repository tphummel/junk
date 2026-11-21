import Foundation
import FoundationModels

/// Reads status from the system's on-device language model.
public struct SystemModelCatalog: ModelCatalog {
    public init() {}

    public func currentStatus() -> ModelStatus {
        let model = SystemLanguageModel.default
        return ModelStatus(
            availability: ModelAvailability(model.availability),
            contextSize: model.contextSize,
            supportedLanguages: model.supportedLanguages.map(\.minimalIdentifier).sorted()
        )
    }
}

extension ModelAvailability {
    init(_ availability: SystemLanguageModel.Availability) {
        switch availability {
        case .available:
            self = .available
        case .unavailable(.deviceNotEligible):
            self = .unavailable(.deviceNotEligible)
        case .unavailable(.appleIntelligenceNotEnabled):
            self = .unavailable(.appleIntelligenceNotEnabled)
        case .unavailable(.modelNotReady):
            self = .unavailable(.modelNotReady)
        case .unavailable(let reason):
            self = .unavailable(.other(String(describing: reason)))
        @unknown default:
            self = .unavailable(.other(String(describing: availability)))
        }
    }
}
