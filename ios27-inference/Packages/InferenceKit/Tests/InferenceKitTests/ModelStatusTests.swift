import InferenceKit
import Testing

private let allStates: [ModelAvailability] = [
    .available,
    .unavailable(.deviceNotEligible),
    .unavailable(.appleIntelligenceNotEnabled),
    .unavailable(.modelNotReady),
    .unavailable(.other("somethingNew")),
]

@Test func onlyAvailableCountsAsAvailable() {
    #expect(allStates.filter(\.isAvailable) == [.available])
}

@Test func everyStateHasItsOwnTitleAndExplanation() {
    #expect(Set(allStates.map(\.title)).count == allStates.count)
    #expect(Set(allStates.map(\.explanation)).count == allStates.count)
}

@Test func onlyTheSettingsSwitchIsFixableInSettings() {
    #expect(allStates.filter(\.isFixableInSettings) == [.unavailable(.appleIntelligenceNotEnabled)])
}

@Test func unknownReasonIsSurfacedInTheExplanation() {
    #expect(ModelAvailability.unavailable(.other("somethingNew")).explanation.contains("somethingNew"))
}

@Test func deviceInfoIsPopulated() {
    let info = DeviceInfo.current
    #expect(!info.osVersion.isEmpty)
    #expect(!info.modelIdentifier.isEmpty)
}

/// Reads the real system model. In CI the model is unavailable, which is fine: this checks the
/// bridge to the framework runs and reports something coherent, not that the model is usable.
@Test func systemCatalogReportsAStatus() {
    let status = SystemModelCatalog().currentStatus()
    #expect(status.contextSize >= 0)
    #expect(status.supportedLanguages == status.supportedLanguages.sorted())
}
