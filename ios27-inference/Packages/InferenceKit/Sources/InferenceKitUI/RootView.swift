import InferenceKit
import SwiftUI

/// The app's root: one tab per section.
public struct RootView: View {
    private let catalog: any ModelCatalog
    private let generator: any TextGenerator
    @State private var selection: AppTab = .status

    public init(
        catalog: any ModelCatalog = SystemModelCatalog(),
        generator: any TextGenerator = SystemTextGenerator()
    ) {
        self.catalog = catalog
        self.generator = generator
    }

    public var body: some View {
        TabView(selection: $selection) {
            ForEach(AppTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: tab) {
                    NavigationStack {
                        content(for: tab)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func content(for tab: AppTab) -> some View {
        switch tab {
        case .status:
            StatusView(catalog: catalog)
        case .playground:
            PlaygroundView(catalog: catalog, generator: generator)
        case .suites, .history:
            ContentUnavailableView(tab.title, systemImage: tab.systemImage, description: Text(tab.placeholder))
                .navigationTitle(tab.title)
        }
    }
}

#Preview {
    RootView()
}
