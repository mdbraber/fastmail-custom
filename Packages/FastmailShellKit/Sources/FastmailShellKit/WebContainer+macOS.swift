#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import SwiftUI
import WebKit

extension WebContainer: NSViewRepresentable {
    public func makeCoordinator() -> WebCoordinator {
        WebCoordinator(model: model, startURL: profile.startURL)
    }

    public func makeNSView(context: Context) -> WKWebView {
        let webView = makeWebView(coordinator: context.coordinator)
        installChromeCSS(in: webView)
        DispatchQueue.main.async { [weak webView] in
            guard let webView, let window = webView.window else { return }
            configureWindow(window)
            observeFullScreen(window, webView: webView)
        }
        return webView
    }

    public func updateNSView(_ nsView: WKWebView, context: Context) {}

    private func installChromeCSS(in webView: WKWebView) {
        guard
            let bundle = try? ScriptStore(loader: loader, overlayName: profile.overlayScriptName).load(),
            let chromeCSS = bundle.chromeCSS,
            let scripts = try? ScriptInjector.userScripts(from: bundle, url: profile.startURL, chromeCSS: chromeCSS),
            let styleScript = scripts.first(where: { $0.source.contains("createElement('style')") })
        else { return }
        webView.configuration.userContentController.addUserScript(styleScript)
    }
}

@MainActor
func configureWindow(_ window: NSWindow) {
    window.styleMask.insert(.fullSizeContentView)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
}

@MainActor
func observeFullScreen(_ window: NSWindow, webView: WKWebView) {
    let center = NotificationCenter.default
    center.addObserver(forName: NSWindow.didEnterFullScreenNotification, object: window, queue: .main) { _ in
        MainActor.assumeIsolated {
            webView.evaluateJavaScript("document.body.classList.add('fmshell-fullscreen')")
        }
    }
    center.addObserver(forName: NSWindow.didExitFullScreenNotification, object: window, queue: .main) { _ in
        MainActor.assumeIsolated {
            webView.evaluateJavaScript("document.body.classList.remove('fmshell-fullscreen')")
        }
    }
}
#endif
