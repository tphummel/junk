import Foundation
import InferenceKit
import Testing

private let request = RunRequest(prompt: "Say hello")

@Test func runnerStreamsSnapshotsThenTheResult() async throws {
    let generator = ScriptedGenerator(updates: [
        GenerationUpdate(text: "Hel"),
        GenerationUpdate(text: "Hello", inputTokens: 12, outputTokens: 4),
    ])
    let events = try await collect(InferenceRunner(generator: generator).run(request))

    #expect(events.count == 3)
    #expect(events[0] == .snapshot("Hel"))
    #expect(events[1] == .snapshot("Hello"))
    guard case .finished(let result) = events[2] else {
        Issue.record("last event should be .finished")
        return
    }
    #expect(result.output == "Hello")
    #expect(result.metrics.inputTokens == 12)
    #expect(result.metrics.outputTokens == 4)
}

@Test func runnerMeasuresFirstTextAndTotalDuration() async throws {
    // The clock is read at start, at the first non-empty text, and at the end: 1s, 2s, 3s.
    let clock = TickingClock()
    let generator = ScriptedGenerator(updates: [
        GenerationUpdate(text: ""),
        GenerationUpdate(text: "Hi"),
        GenerationUpdate(text: "Hi there", outputTokens: 4),
    ])
    let events = try await collect(InferenceRunner(generator: generator, now: clock.now).run(request))

    guard case .finished(let result) = events.last else {
        Issue.record("last event should be .finished")
        return
    }
    #expect(result.metrics.timeToFirstText == .seconds(1))
    #expect(result.metrics.duration == .seconds(2))
    #expect(result.metrics.outputTokensPerSecond == 2)
}

@Test func emptyResponseHasNoFirstTextTime() async throws {
    let events = try await collect(InferenceRunner(generator: ScriptedGenerator(updates: [])).run(request))

    #expect(events.count == 1)
    guard case .finished(let result) = events.last else {
        Issue.record("last event should be .finished")
        return
    }
    #expect(result.output.isEmpty)
    #expect(result.metrics.timeToFirstText == nil)
    #expect(result.metrics.outputTokensPerSecond == nil)
}

@Test func runnerPassesFailuresThroughWithoutAResult() async {
    let failure = RunFailure(message: "boom", suggestion: "try again")
    let generator = ScriptedGenerator(updates: [GenerationUpdate(text: "partial")], failure: failure)

    var events: [RunEvent] = []
    await #expect(throws: failure) {
        for try await event in InferenceRunner(generator: generator).run(request) {
            events.append(event)
        }
    }
    #expect(events == [.snapshot("partial")])
}

@Test func requestSurvivesAnEncodingRoundTrip() throws {
    let original = RunRequest(
        instructions: "Be brief.",
        prompt: "Why is the sky blue?",
        options: RunOptions(temperature: 0.3, maximumResponseTokens: 128, sampling: .greedy)
    )
    let decoded = try JSONDecoder().decode(RunRequest.self, from: JSONEncoder().encode(original))
    #expect(decoded == original)
}
