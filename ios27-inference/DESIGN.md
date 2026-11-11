# Inference Toolkit for iOS — design

A native iOS app for poking at, measuring, and building on Apple's on-device
language model through the **Foundation Models** framework. Working name:
**Inference Toolkit** (folder `ios27-inference`, bundle id
`com.tomhummel.InferenceToolkit`). Both are easy to change before code exists.

Status: milestones 0–2 built; not yet run on a device.

## Goals

1. **Access** — show at a glance whether the model is usable on this device, and why not if it isn't.
2. **Test** — an interactive playground for every major capability: text, streaming, guided generation,
   tool calling, image input.
3. **Measure** — record latency and token usage for every run, and run saved prompt suites repeatedly
   so results can be compared across OS updates and settings.
4. **Use** — keep the engine in a standalone Swift package (`InferenceKit`) that other apps of mine can import.

## Non-goals (v1)

- Anything that leaves the device: Apple's Private Cloud Compute model and third-party cloud providers. Every run uses the on-device model only.
- Bring-your-own weights via Core AI / MLX.
- Adapters and fine-tuning.
- iPad/Mac-specific layouts beyond what SwiftUI gives for free, iCloud sync.
- App Store review and public release (see Distribution).

## Platform decisions

| Decision | Choice | Why |
|---|---|---|
| Deployment target | **iOS 27.0** | Image input, dynamic profiles, and `response.usage` are all 27-only. Supporting 26 means `#available` branches around most of the app. |
| UI | SwiftUI, `@Observable`, `NavigationStack` in a `TabView` | Current Apple defaults. |
| Language mode | Swift 6, strict concurrency | Model work is all async; catch isolation mistakes at compile time. |
| Persistence | SwiftData | Saved prompts, suites, and run history are simple relational data. |
| Tests | Swift Testing | Unit tests against a fake `LanguageModel`; no device model needed. |
| Dependencies | None | Apple frameworks only. |
| Project file | XcodeGen (`project.yml`), `.xcodeproj` not committed | A hand-written `pbxproj` is fragile, and this lets the project be authored without Xcode open. |

## Framework surface we exercise

Names below are from WWDC26 session 241 and the iOS 26 docs. They have **not** been compiled against the
SDK yet; each is confirmed or corrected in the milestone that first uses it.

| Area | API |
|---|---|
| Availability | `SystemLanguageModel.default.availability` and its unavailable reasons (device not eligible, Apple Intelligence off, model not ready) |
| Limits | `contextSize`, `tokenCount(for:)` |
| Sessions | `LanguageModelSession(model:tools:instructions:)`, `respond(to:)`, `streamResponse(to:)`, `prewarm()`, `transcript` |
| Options | `GenerationOptions` (temperature, sampling mode, maximum response tokens) |
| Guided generation | `@Generable`, `@Guide`, `PartiallyGenerated` snapshots, `DynamicGenerationSchema` for schemas defined at runtime |
| Tools | `Tool` protocol; built-in `OCRTool`, `BarcodeReaderTool` |
| Image input | `Attachment(...)` inside a prompt |
| Accounting | `response.usage.input/output` token counts, including cached tokens |
| Errors | `LanguageModelSession.GenerationError` (context window exceeded, guardrail violation, unsupported language), `ToolCallError` |

## Architecture

```
ios27-inference/
  project.yml                  XcodeGen spec
  App/                         thin app target: @main, tab shell, SwiftData container
  Packages/InferenceKit/       local Swift package, all logic
    Sources/InferenceKit/        engine — no SwiftUI
    Sources/InferenceKitUI/      feature views and view models
    Tests/InferenceKitTests/
```

### InferenceKit (engine)

- **`ModelCatalog`** — the on-device system model with its availability, context size, supported languages,
  and a human-readable explanation when unavailable.
- **`RunRequest`** — a value type describing one run: model, instructions, prompt, attachments, generation
  options, enabled tools, optional output schema. `Codable`, so it can be saved and exported.
- **`InferenceRunner`** — an actor that executes a `RunRequest` and returns an `AsyncThrowingStream<RunEvent>`:
  `.started`, `.snapshot(text or partial structure)`, `.toolCall`, `.toolResult`, `.finished(RunResult)`.
  One code path serves the playground, the benchmark runner, and any other app that imports the package.
- **`RunResult` / `RunMetrics`** — output, full transcript, and timings: prewarm time, time to first snapshot,
  total duration, input/output tokens, tokens per second. Timed with `ContinuousClock`.
- **`ToolRegistry`** — sample tools that can be toggled per run. v1 set needs no permissions: current date and
  time, calculator, device info, plus the built-in OCR and barcode tools. Each records its calls for the trace view.
- **`SchemaLibrary`** — a few compiled `@Generable` examples (summary with tags, extracted contact, classified
  sentiment) and a builder that turns a user-edited field list into a `DynamicGenerationSchema`.
- **`RunError`** — maps framework errors to a small enum with user-facing text and a suggested fix.

Every dependency on a real model sits behind a small protocol of our own (`ModelCatalog`, `TextGenerator`), so
tests inject scripted fakes and the framework is touched in only a couple of files.

### App screens

| Tab | What it does |
|---|---|
| **Status** | Model availability with the reason when unavailable, context size, supported languages, OS and device, and a deep link to Settings when Apple Intelligence is off. |
| **Playground** | Instructions and prompt editors, image picker, generation options, tool toggles, optional output schema. Streams the response. A metrics bar shows first-token time, duration, and tokens. A transcript inspector shows every entry including tool calls. A live token counter shows prompt size against the context window. |
| **Suites** | Saved prompt sets. Run a suite N times against a chosen configuration; see per-case median and spread for latency and tokens; compare two runs side by side. |
| **History** | Every run with its request, output, and metrics. Re-open any run in the Playground. Export as JSON or CSV through the share sheet. |

### Data model (SwiftData)

- `SavedPrompt` — name, encoded `RunRequest`.
- `Suite` — name, ordered cases (each a `RunRequest` plus optional expected-output check: contains, regex, or valid-against-schema).
- `RunRecord` — timestamp, OS build, device model, encoded request, output, metrics, error if any, optional suite and batch ids.

OS build is stored on every record because "did this get faster or slower after the update" is the main
reason to keep history.

## Native practices we hold to

- Check availability before creating any session; every unavailable state has its own explanation screen.
- Stream by default; cancelling the view's task cancels generation.
- `prewarm()` when the Playground appears.
- Dynamic Type, VoiceOver labels, Dark Mode, and system colors and materials throughout; no custom design system.
- Strings in a String Catalog.
- A privacy manifest; no network calls at all. Prompts, images, and run history stay on the device unless you export them yourself.
- Photo access through `PhotosPicker`, which needs no permission prompt.

## Build and verification

The model only runs on Apple Intelligence-capable hardware, and the project is being authored from a Linux
environment with no Swift toolchain. That shapes how we get feedback:

1. **CI** — a GitHub Actions workflow (`.github/workflows/ios27-inference.yml`, path-filtered like the
   other projects here) on a macOS runner: install XcodeGen, generate the project, `xcodebuild build` and
   `test` on a simulator. Tests use the fake model, so no Apple Intelligence is needed. This is the compile
   check for every push.
2. **On device** — you open the generated project in Xcode and run it on your iPhone. Real model behavior,
   and performance numbers can only be checked here.

The workflow uses GitHub's `xcode-27` hosted runner. It triggers on pull requests and pushes to `main`, so it
first runs when a PR is opened for this branch.

## Distribution

No App Store submission. Two ways onto a device:

- **Direct install from Xcode** — the default during development. Connect the phone, turn on Developer Mode,
  choose a signing team, press Run. With a paid Developer Program team the install lasts a year; with a free
  Apple ID it lasts 7 days and has to be re-run from Xcode.
- **TestFlight** — optional, for installing without a Mac nearby or sharing with others. Needs a paid team, a
  bundle id registered to it, and an app record in App Store Connect. Internal testers need no Beta App Review.
  Builds expire after 90 days. Upload is manual: Archive in Xcode, then Distribute.

The skeleton already carries what a TestFlight upload checks for (app icon, privacy manifest,
`ITSAppUsesNonExemptEncryption = NO`, version and build numbers), so switching later is account setup only.

## Milestones

| # | Deliverable | Done when |
|---|---|---|
| 0 | Skeleton: XcodeGen spec, app shell with four empty tabs, `InferenceKit` package, CI workflow | CI builds and runs the skeleton tests; the empty shell runs on your phone |
| 1 | Status tab and `ModelCatalog` | Shows correct availability on your phone and in the simulator |
| 2 | `InferenceRunner`, text Playground with streaming, options, metrics | A prompt streams on device with timings; runner unit tests pass against the fake |
| 3 | History with SwiftData and export | Runs persist across launches and export as JSON |
| 4 | Guided generation: schema library and runtime schema builder | Structured output streams field by field |
| 5 | Tools: registry, toggles, transcript trace | Tool calls visible in the inspector |
| 6 | Image input, with the built-in OCR and barcode tools | A prompt with an attached photo works on device |
| 7 | Suites: repeated runs, statistics, comparison | A suite of 5 cases runs 10 times and reports medians |

Each milestone is a separate commit that leaves CI green.

## Open questions

1. ~~iOS 27 minimum~~ — confirmed.
2. ~~Private Cloud Compute~~ — dropped; on-device only.
3. **Apple Developer team** — `DEVELOPMENT_TEAM` in `project.yml` is empty; fill it in, or pick the team in Xcode each time the project is regenerated.
4. **Evaluations framework** — Apple shipped one at WWDC26 but its API isn't in the material I could read. Suites are designed to stand alone; adopt Apple's framework later if it fits.
5. **Name and bundle id** — keep the working ones?

## References

- [What's new in the Foundation Models framework — WWDC26](https://developer.apple.com/videos/play/wwdc2026/241/)
- [WWDC26 iOS guide](https://developer.apple.com/wwdc26/guides/ios/)
- [Meet the Foundation Models framework — WWDC25 notes](https://wwdcnotes.com/documentation/wwdc25-286-meet-the-foundation-models-framework/)
