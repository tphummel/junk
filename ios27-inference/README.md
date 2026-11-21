# Inference Toolkit for iOS

A native iOS app and Swift package for testing and measuring Apple's on-device language model through the
Foundation Models framework. See [DESIGN.md](DESIGN.md) for what is being built and in what order.

**Status: milestone 2.** The Status tab reports model availability, limits, and device details. The Playground streams a text response with generation options and timing and token metrics. Suites and History are placeholders.

## Requirements

- A Mac with Xcode 27 and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- An iPhone on iOS 27 that supports Apple Intelligence, for anything beyond the placeholder screens

## Run it on your iPhone

1. `cd ios27-inference && xcodegen generate && open InferenceToolkit.xcodeproj`
2. Select the InferenceToolkit target, open Signing & Capabilities, and choose your team.
   To make that stick across regenerations, put the team id in `DEVELOPMENT_TEAM` in `project.yml`.
3. Connect the phone, enable Developer Mode on it when prompted (Settings, Privacy & Security), pick it as the
   run destination, and press Run.

The Xcode project is generated and not committed; rerun `xcodegen generate` after pulling changes that add files.

## Tests

Run from Xcode with Cmd-U, or see `.github/workflows/ios27-inference.yml` for the command line.

## Layout

- `project.yml` — XcodeGen spec
- `App/` — app entry point, asset catalog, privacy manifest
- `Packages/InferenceKit/` — `InferenceKit` (engine) and `InferenceKitUI` (screens), plus tests
