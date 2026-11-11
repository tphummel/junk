import InferenceKit
import Observation

/// State and actions for the Playground screen.
@MainActor
@Observable
final class PlaygroundModel {
    var instructions = ""
    var prompt = ""

    var usesCustomTemperature = false
    var temperature = 0.7
    var limitsResponse = false
    var maximumResponseTokens = 256
    var sampling = RunOptions.Sampling.automatic

    private(set) var output = ""
    private(set) var metrics: RunMetrics?
    private(set) var failure: RunFailure?
    private(set) var isRunning = false

    private let runner: InferenceRunner
    private var task: Task<Void, Never>?

    init(runner: InferenceRunner) {
        self.runner = runner
    }

    var canRun: Bool {
        !isRunning && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var request: RunRequest {
        RunRequest(
            instructions: instructions,
            prompt: prompt,
            options: RunOptions(
                temperature: usesCustomTemperature ? temperature : nil,
                maximumResponseTokens: limitsResponse ? maximumResponseTokens : nil,
                sampling: sampling
            )
        )
    }

    func prewarm() {
        runner.prewarm()
    }

    func run() {
        guard canRun else { return }
        output = ""
        metrics = nil
        failure = nil
        isRunning = true
        let request = request
        task = Task {
            do {
                for try await event in runner.run(request) {
                    switch event {
                    case .snapshot(let text):
                        output = text
                    case .finished(let result):
                        output = result.output
                        metrics = result.metrics
                    }
                }
            } catch is CancellationError {
                // Stopped by the user; keep whatever text arrived.
            } catch let runFailure as RunFailure {
                failure = runFailure
            } catch {
                failure = RunFailure(message: error.localizedDescription)
            }
            isRunning = false
        }
    }

    func stop() {
        task?.cancel()
    }

    /// Waits for the current run, if any. For tests.
    func waitUntilFinished() async {
        await task?.value
    }
}
