import InferenceKit
import InferenceKitUI
import Testing

@Test func tabsAreInDesignOrder() {
    #expect(AppTab.allCases.map(\.title) == ["Status", "Playground", "Suites", "History"])
}

@Test func everyTabHasAnIcon() {
    for tab in AppTab.allCases {
        #expect(!tab.systemImage.isEmpty)
    }
}

@Test func packageReportsAVersion() {
    #expect(!InferenceKit.version.isEmpty)
}
