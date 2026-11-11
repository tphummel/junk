// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "InferenceKit",
    platforms: [.iOS("27.0")],
    products: [
        .library(name: "InferenceKit", targets: ["InferenceKit"]),
        .library(name: "InferenceKitUI", targets: ["InferenceKitUI"]),
    ],
    targets: [
        .target(name: "InferenceKit"),
        .target(name: "InferenceKitUI", dependencies: ["InferenceKit"]),
        .testTarget(name: "InferenceKitTests", dependencies: ["InferenceKit", "InferenceKitUI"]),
    ]
)
