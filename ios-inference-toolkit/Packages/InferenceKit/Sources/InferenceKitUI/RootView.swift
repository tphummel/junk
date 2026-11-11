import SwiftUI

/// The app's root: one tab per section.
public struct RootView: View {
    @State private var selection: AppTab = .status

    public init() {}

    public var body: some View {
        TabView(selection: $selection) {
            ForEach(AppTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: tab) {
                    NavigationStack {
                        ContentUnavailableView(
                            tab.title,
                            systemImage: tab.systemImage,
                            description: Text(tab.placeholder)
                        )
                        .navigationTitle(tab.title)
                    }
                }
            }
        }
    }
}

#Preview {
    RootView()
}
