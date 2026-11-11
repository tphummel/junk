# notes

- 2026-11-11: Project kicked off. Step 1 is DESIGN.md; code comes after the design is agreed.
- Target SDK is Apple's Foundation Models framework. Checked what changed at WWDC26 (session 241 + iOS guide):
  `LanguageModel` protocol, `PrivateCloudComputeLanguageModel`, image `Attachment`s, `OCRTool`/`BarcodeReaderTool`,
  `LanguageModelSession.DynamicProfile`, `response.usage` token counts, `contextSize`/`tokenCount(for:)` (26.4),
  an Evaluations framework (type names not published on the pages I read).
- API names in DESIGN.md come from the session page, not from compiling against the SDK. Verify each on first build.
- Authoring environment is Linux with no Swift/Xcode toolchain, so nothing here can be compiled locally.
  The design leans on XcodeGen + a macOS GitHub Actions job to get compile/test feedback.
- TestFlight-only distribution (no App Store review). Added Distribution section; TestFlight prerequisites pulled into milestone 0.
- iOS 27 minimum confirmed. TestFlight is optional: direct install from Xcode is the default path.
- Milestone 0 written: project.yml, App/, Packages/InferenceKit, CI workflow. NOT compiled anywhere yet —
  no toolchain here, and the workflow only triggers on PRs / pushes to main.
- GitHub hosted runner label for Xcode 27 is `xcode-27` (GA 2026-10-15); there is no `macos-27` label.
- Unverified until CI runs: XcodeGen `testTargets: - package: InferenceKit/InferenceKitTests` syntax,
  `.iOS("27.0")` in Package.swift, INFOPLIST_KEY_ITSAppUsesNonExemptEncryption being honoured.
- App icon generated with PIL (gradient, bars, spark); opaque RGB, 1024px.
- On-device only: Private Cloud Compute, model switching and reasoning level removed from the design. No network calls at all.
- Renamed the folder and workflow to ios27-inference (was ios-inference-toolkit). App/Xcode names unchanged.
- PR #199 opened. First CI run green on xcode-27: XcodeGen package test target syntax, `.iOS("27.0")` and the
  generated Info.plist all worked first time. 3 Swift Testing tests ran in the simulator.
- Milestone 1: ModelCatalog protocol + SystemModelCatalog (FoundationModels), StatusView. Own
  `ModelAvailability` enum mirrors the framework's so explanations are testable without the model.
- No public deep link to the Apple Intelligence settings pane; "Open Settings" opens the app's own settings page.
- CI green on milestone 1 (9 tests). `SystemLanguageModel.default.availability`, `.contextSize`,
  `.supportedLanguages` all compile against the iOS 27 SDK as written.
- Milestone 2: RunRequest/RunOptions/RunMetrics, InferenceRunner (timing via injectable `now`), SystemTextGenerator,
  Playground. Fakes go through our own TextGenerator protocol rather than Apple's `LanguageModel`, whose
  requirements I haven't read.
- From Apple's DocC JSON: token usage is on each stream `Snapshot` (`snapshot.usage`, iOS 27), no need to call
  `collect()`. `GenerationOptions(sampling:...)` is deprecated in favour of `samplingMode:`.
- Each Playground run uses a fresh session (single turn). Prewarm is called on a throwaway session; whether that
  actually speeds up the next session needs measuring on device.
