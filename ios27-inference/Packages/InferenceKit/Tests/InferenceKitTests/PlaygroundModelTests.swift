import InferenceKit
@testable import InferenceKitUI
import Testing

@MainActor
@Test func playgroundBuildsTheRequestFromItsSettings() {
    let model = PlaygroundModel(runner: InferenceRunner(generator: ScriptedGenerator(updates: [])))
    model.prompt = "Hello"
    #expect(model.request.options == RunOptions())

    model.usesCustomTemperature = true
    model.temperature = 0.2
    model.limitsResponse = true
    model.maximumResponseTokens = 64
    model.sampling = .greedy
    #expect(model.request.options == RunOptions(temperature: 0.2, maximumResponseTokens: 64, sampling: .greedy))
}

@MainActor
@Test func playgroundCannotRunAnEmptyPrompt() {
    let model = PlaygroundModel(runner: InferenceRunner(generator: ScriptedGenerator(updates: [])))
    model.prompt = "  \n"
    #expect(!model.canRun)
    model.run()
    #expect(!model.isRunning)
}

@MainActor
@Test func playgroundShowsOutputAndMetricsAfterARun() async {
    let generator = ScriptedGenerator(updates: [GenerationUpdate(text: "Hello", inputTokens: 3, outputTokens: 1)])
    let model = PlaygroundModel(runner: InferenceRunner(generator: generator))
    model.prompt = "Say hello"

    model.run()
    #expect(model.isRunning)
    await model.waitUntilFinished()

    #expect(!model.isRunning)
    #expect(model.output == "Hello")
    #expect(model.metrics?.outputTokens == 1)
    #expect(model.failure == nil)
}

@MainActor
@Test func playgroundKeepsPartialOutputAndShowsTheFailure() async {
    let failure = RunFailure(message: "boom")
    let generator = ScriptedGenerator(updates: [GenerationUpdate(text: "partial")], failure: failure)
    let model = PlaygroundModel(runner: InferenceRunner(generator: generator))
    model.prompt = "Say hello"

    model.run()
    await model.waitUntilFinished()

    #expect(model.output == "partial")
    #expect(model.failure == failure)
    #expect(model.metrics == nil)
    #expect(!model.isRunning)
}
