import InferenceKit
import SwiftUI

/// Prompt the model, watch the response stream, and see how long it took.
struct PlaygroundView: View {
    let catalog: any ModelCatalog
    @State private var model: PlaygroundModel
    @State private var availability: ModelAvailability?
    @Environment(\.scenePhase) private var scenePhase

    init(catalog: any ModelCatalog, generator: any TextGenerator) {
        self.catalog = catalog
        _model = State(initialValue: PlaygroundModel(runner: InferenceRunner(generator: generator)))
    }

    var body: some View {
        Group {
            if let availability, !availability.isAvailable {
                ContentUnavailableView(
                    availability.title,
                    systemImage: "exclamationmark.triangle",
                    description: Text(availability.explanation)
                )
            } else {
                form
            }
        }
        .navigationTitle(AppTab.playground.title)
        .onAppear { refreshAvailability() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { refreshAvailability() }
        }
    }

    private var form: some View {
        Form {
            Section("Instructions") {
                TextField("Optional guidance for the model", text: $model.instructions, axis: .vertical)
                    .lineLimit(1...6)
            }
            Section("Prompt") {
                TextField("Ask something", text: $model.prompt, axis: .vertical)
                    .lineLimit(2...10)
            }
            Section("Options") {
                Picker("Sampling", selection: $model.sampling) {
                    Text("Automatic").tag(RunOptions.Sampling.automatic)
                    Text("Greedy").tag(RunOptions.Sampling.greedy)
                }
                Toggle("Set temperature", isOn: $model.usesCustomTemperature)
                if model.usesCustomTemperature {
                    LabeledContent("Temperature", value: model.temperature.formatted(.number.precision(.fractionLength(2))))
                    Slider(value: $model.temperature, in: 0...2, step: 0.05)
                        .accessibilityLabel("Temperature")
                }
                Toggle("Limit response length", isOn: $model.limitsResponse)
                if model.limitsResponse {
                    Stepper(
                        "Up to \(model.maximumResponseTokens) tokens",
                        value: $model.maximumResponseTokens,
                        in: 16...4096,
                        step: 16
                    )
                }
            }
            if let failure = model.failure {
                Section("Problem") {
                    Label(failure.message, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    if let suggestion = failure.suggestion {
                        Text(suggestion)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if !model.output.isEmpty || model.isRunning {
                Section("Response") {
                    if model.output.isEmpty {
                        ProgressView()
                    } else {
                        Text(model.output)
                            .textSelection(.enabled)
                    }
                }
            }
            if let metrics = model.metrics {
                Section("Metrics") {
                    if let first = metrics.timeToFirstText {
                        LabeledContent("First text", value: Self.format(first))
                    }
                    LabeledContent("Total time", value: Self.format(metrics.duration))
                    if let input = metrics.inputTokens {
                        LabeledContent("Input tokens", value: input.formatted())
                    }
                    if let output = metrics.outputTokens {
                        LabeledContent("Output tokens", value: output.formatted())
                    }
                    if let rate = metrics.outputTokensPerSecond {
                        LabeledContent("Tokens per second", value: rate.formatted(.number.precision(.fractionLength(1))))
                    }
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if model.isRunning {
                    Button("Stop", systemImage: "stop.fill") { model.stop() }
                } else {
                    Button("Run", systemImage: "play.fill") { model.run() }
                        .disabled(!model.canRun)
                }
            }
        }
        .onAppear { model.prewarm() }
        .onDisappear { model.stop() }
    }

    private func refreshAvailability() {
        availability = catalog.currentStatus().availability
    }

    private static func format(_ duration: Duration) -> String {
        duration.formatted(.units(allowed: [.seconds, .milliseconds], width: .abbreviated))
    }
}
