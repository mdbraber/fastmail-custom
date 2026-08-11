#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import SwiftUI
import WebKit

extension WebContainer: NSViewRepresentable {
    public func makeCoordinator() -> WebCoordinator {
        WebCoordinator(model: model, startURL: profile.startURL)
    }

    public func makeNSView(context: Context) -> WKWebView {
        makeWebView(coordinator: context.coordinator)
    }

    public func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#endif
