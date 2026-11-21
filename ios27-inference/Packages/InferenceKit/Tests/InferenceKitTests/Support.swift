import Foundation
import InferenceKit

/// Yields a fixed script of updates, then finishes or throws.
struct ScriptedGenerator: TextGenerator {
    var updates: [GenerationUpdate]
    var failure: RunFailure?

    func generate(_ request: RunRequest) -> AsyncThrowingStream<GenerationUpdate, any Error> {
        AsyncThrowingStream { continuation in
            for update in updates {
                continuation.yield(update)
            }
            continuation.finish(throwing: failure)
        }
    }
}

/// A clock reading that advances one second every time it is read.
final class TickingClock: @unchecked Sendable {
    private let lock = NSLock()
    private let base = ContinuousClock.now
    private var ticks = 0

    func now() -> ContinuousClock.Instant {
        lock.withLock {
            ticks += 1
            return base.advanced(by: .seconds(ticks))
        }
    }
}

func collect(_ stream: AsyncThrowingStream<RunEvent, any Error>) async throws -> [RunEvent] {
    var events: [RunEvent] = []
    for try await event in stream {
        events.append(event)
    }
    return events
}
