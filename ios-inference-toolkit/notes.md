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
