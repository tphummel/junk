# notes

- 2026-11-11: Project kicked off. Step 1 is DESIGN.md; code comes after the design is agreed.
- Target SDK is Apple's Foundation Models framework. Checked what changed at WWDC26 (session 241 + iOS guide):
  `LanguageModel` protocol, `PrivateCloudComputeLanguageModel`, image `Attachment`s, `OCRTool`/`BarcodeReaderTool`,
  `LanguageModelSession.DynamicProfile`, `response.usage` token counts, `contextSize`/`tokenCount(for:)` (26.4),
  an Evaluations framework (type names not published on the pages I read).
- API names in DESIGN.md come from the session page, not from compiling against the SDK. Verify each on first build.
- Authoring environment is Linux with no Swift/Xcode toolchain, so nothing here can be compiled locally.
  The design leans on XcodeGen + a macOS GitHub Actions job to get compile/test feedback.
