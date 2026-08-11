#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import SwiftUI
import WebKit

extension WebContainer: NSViewRepresentable {
    public func makeCoordinator() -> WebCoordinator {
        WebCoordinator(model: model, startURL: profile.startURL)
    }

    public func makeNSView(context: Context) -> WKWebView {
        let webView = makeWebView(coordinator: context.coordinator)
        DispatchQueue.main.async { [weak webView] in
            guard let window = webView?.window else { return }
            configureWindow(window)
        }
        return webView
    }

    public func updateNSView(_ nsView: WKWebView, context: Context) {}
}

@MainActor
func configureWindow(_ window: NSWindow) {
    window.styleMask.insert(.fullSizeContentView)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
}
#endif
