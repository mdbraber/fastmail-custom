// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FastmailShellKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FastmailShellKit", targets: ["FastmailShellKit"])
    ],
    targets: [
        .target(
            name: "FastmailShellKit",
            resources: [.copy("Resources/harness.js")]
        ),
        .testTarget(
            name: "FastmailShellKitTests",
            dependencies: ["FastmailShellKit"]
        )
    ]
)
