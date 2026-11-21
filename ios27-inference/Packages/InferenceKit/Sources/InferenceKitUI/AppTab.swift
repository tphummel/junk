/// The app's top-level sections.
public enum AppTab: String, CaseIterable, Identifiable, Sendable {
    case status
    case playground
    case suites
    case history

    public var id: Self { self }

    public var title: String {
        switch self {
        case .status: "Status"
        case .playground: "Playground"
        case .suites: "Suites"
        case .history: "History"
        }
    }

    public var systemImage: String {
        switch self {
        case .status: "checkmark.seal"
        case .playground: "text.bubble"
        case .suites: "list.bullet.clipboard"
        case .history: "clock.arrow.circlepath"
        }
    }

    /// Shown until the section is built.
    var placeholder: String {
        switch self {
        case .status: "Model availability and limits will appear here."
        case .playground: "Prompt the model and watch it stream here."
        case .suites: "Saved prompt suites and repeated runs will appear here."
        case .history: "Past runs and their metrics will appear here."
        }
    }
}
