import InferenceKit
import SwiftUI

/// Shows whether the on-device model is usable, its limits, and the device it is running on.
struct StatusView: View {
    let catalog: any ModelCatalog

    @State private var status: ModelStatus?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    private let device = DeviceInfo.current

    var body: some View {
        List {
            if let status {
                Section("Model") {
                    availabilityRow(status.availability)
                    if status.availability.isFixableInSettings {
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                openURL(url)
                            }
                        }
                    }
                }
                Section("Limits") {
                    LabeledContent("Context window", value: "\(status.contextSize.formatted()) tokens")
                    NavigationLink {
                        LanguageList(identifiers: status.supportedLanguages)
                    } label: {
                        LabeledContent("Languages", value: status.supportedLanguages.count.formatted())
                    }
                }
            }
            Section("Device") {
                LabeledContent("Model", value: device.modelIdentifier)
                LabeledContent("OS", value: device.osVersion)
                LabeledContent("Toolkit", value: InferenceKit.version)
            }
        }
        .navigationTitle(AppTab.status.title)
        .refreshable { refresh() }
        .onAppear { refresh() }
        .onChange(of: scenePhase) { _, phase in
            // Availability can change while the app is in the background, e.g. after a trip to Settings.
            if phase == .active { refresh() }
        }
    }

    private func availabilityRow(_ availability: ModelAvailability) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(availability.title)
                    .font(.headline)
                Text(availability.explanation)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: availability.isAvailable ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(availability.isAvailable ? .green : .orange)
        }
        .accessibilityElement(children: .combine)
    }

    private func refresh() {
        status = catalog.currentStatus()
    }
}

private struct LanguageList: View {
    let identifiers: [String]

    var body: some View {
        List(identifiers, id: \.self) { identifier in
            LabeledContent(Locale.current.localizedString(forIdentifier: identifier) ?? identifier, value: identifier)
        }
        .navigationTitle("Languages")
        .overlay {
            if identifiers.isEmpty {
                ContentUnavailableView("No languages reported", systemImage: "globe")
            }
        }
    }
}

private struct PreviewCatalog: ModelCatalog {
    var availability: ModelAvailability
    func currentStatus() -> ModelStatus {
        ModelStatus(availability: availability, contextSize: 8192, supportedLanguages: ["de", "en", "ja"])
    }
}

#Preview("Available") {
    NavigationStack { StatusView(catalog: PreviewCatalog(availability: .available)) }
}

#Preview("Apple Intelligence off") {
    NavigationStack { StatusView(catalog: PreviewCatalog(availability: .unavailable(.appleIntelligenceNotEnabled))) }
}
