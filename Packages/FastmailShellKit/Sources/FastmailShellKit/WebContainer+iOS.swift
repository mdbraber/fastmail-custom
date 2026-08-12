#if canImport(UIKit)
import SwiftUI
import WebKit

extension WebContainer: UIViewRepresentable {
    public func makeCoordinator() -> WebCoordinator {
        WebCoordinator(model: model, startURL: loadURL)
    }

    public func makeUIView(context: Context) -> WKWebView {
        makeWebView(coordinator: context.coordinator)
    }

    public func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif
