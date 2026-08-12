#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import SwiftUI
import WebKit

extension WebContainer: NSViewRepresentable {
    public func makeCoordinator() -> WebCoordinator {
        WebCoordinator(model: model, startURL: profile.startURL)
    }

    public func makeNSView(context: Context) -> WKWebView {
        let webView = makeWebView(coordinator: context.coordinator) { controller in
            installChromeCSS(in: controller)
        }
        DispatchQueue.main.async { [weak webView] in
            guard let webView, let window = webView.window else { return }
            configureWindow(window)
            observeFullScreen(window, webView: webView)
        }
        return webView
    }

    public func updateNSView(_ nsView: WKWebView, context: Context) {}

    private func installChromeCSS(in controller: WKUserContentController) {
        guard
            let bundle = try? ScriptStore(loader: loader, overlayName: profile.overlayScriptName).load(),
            let chromeCSS = bundle.chromeCSS,
            let scripts = try? ScriptInjector.userScripts(from: bundle, url: profile.startURL, chromeCSS: chromeCSS),
            let styleScript = scripts.first(where: { $0.source.contains("createElement('style')") })
        else { return }
        controller.addUserScript(styleScript)
    }
}

@MainActor
func configureWindow(_ window: NSWindow) {
    window.styleMask.insert(.fullSizeContentView)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
}

@MainActor
var fullScreenObservers: [ObjectIdentifier: FullScreenObserver] = [:]

@MainActor
func observeFullScreen(_ window: NSWindow, webView: WKWebView) {
    let key = ObjectIdentifier(window)
    fullScreenObservers[key]?.tearDown()
    fullScreenObservers[key] = FullScreenObserver(window: window, webView: webView) {
        fullScreenObservers[key] = nil
    }
}

@MainActor
final class FullScreenObserver {
    private var enterToken: NSObjectProtocol?
    private var exitToken: NSObjectProtocol?
    private var closeToken: NSObjectProtocol?

    init(window: NSWindow, webView: WKWebView, onClose: @escaping @MainActor @Sendable () -> Void) {
        let center = NotificationCenter.default
        enterToken = center.addObserver(
            forName: NSWindow.didEnterFullScreenNotification, object: window, queue: .main
        ) { [weak webView] _ in
            MainActor.assumeIsolated {
                webView?.evaluateJavaScript("document.body.classList.add('fmshell-fullscreen')")
            }
        }
        exitToken = center.addObserver(
            forName: NSWindow.didExitFullScreenNotification, object: window, queue: .main
        ) { [weak webView] _ in
            MainActor.assumeIsolated {
                webView?.evaluateJavaScript("document.body.classList.remove('fmshell-fullscreen')")
            }
        }
        closeToken = center.addObserver(
            forName: NSWindow.willCloseNotification, object: window, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.tearDown()
                onClose()
            }
        }
    }

    var isActive: Bool {
        enterToken != nil || exitToken != nil || closeToken != nil
    }

    func tearDown() {
        let center = NotificationCenter.default
        [enterToken, exitToken, closeToken].compactMap { $0 }.forEach(center.removeObserver)
        enterToken = nil
        exitToken = nil
        closeToken = nil
    }
}
#endif
