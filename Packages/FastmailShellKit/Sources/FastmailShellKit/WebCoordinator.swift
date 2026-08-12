import Foundation
import WebKit

#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

@MainActor
public final class WebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let model: ShellModel
    private var lastURL: URL
    private let openExternally: @MainActor (URL) -> Void

    public init(
        model: ShellModel,
        startURL: URL,
        openExternally: @escaping @MainActor (URL) -> Void = { url in
            #if canImport(UIKit)
            UIApplication.shared.open(url)
            #else
            NSWorkspace.shared.open(url)
            #endif
        }
    ) {
        self.model = model
        self.lastURL = startURL
        self.openExternally = openExternally
    }

    enum FrameOutcome: Equatable {
        case allow
        case cancel
        case cancelAndOpenExternally
        case cancelWithBanner
    }

    nonisolated static func outcome(for decision: NavigationDecision, isMainFrame: Bool) -> FrameOutcome {
        switch (isMainFrame, decision) {
        case (_, .allow):
            return .allow
        case (false, .openExternally), (false, .download), (false, .refuse):
            return .cancel
        case (true, .openExternally), (true, .download):
            return .cancelAndOpenExternally
        case (true, .refuse):
            return .cancelWithBanner
        }
    }

    nonisolated static func windowOpenOutcome(
        navigationType: WKNavigationType,
        decision: NavigationDecision
    ) -> FrameOutcome {
        guard navigationType == .linkActivated else { return .cancel }
        switch decision {
        case .allow: return .allow
        case .openExternally, .download: return .cancelAndOpenExternally
        case .refuse: return .cancelWithBanner
        }
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        guard let targetFrame = navigationAction.targetFrame else {
            decisionHandler(.allow)
            return
        }
        let decision = NavigationPolicy.decide(url: url)
        switch Self.outcome(for: decision, isMainFrame: targetFrame.isMainFrame) {
        case .allow:
            if targetFrame.isMainFrame {
                lastURL = url
            }
            decisionHandler(.allow)
        case .cancel:
            decisionHandler(.cancel)
        case .cancelAndOpenExternally:
            decisionHandler(.cancel)
            openExternally(url)
        case .cancelWithBanner:
            decisionHandler(.cancel)
            model.banner = Self.refusalBanner(for: url)
        }
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void
    ) {
        let contentDisposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")
        let decision = NavigationPolicy.decideResponse(
            canShowMIMEType: navigationResponse.canShowMIMEType,
            contentDisposition: contentDisposition
        )
        switch Self.outcome(for: decision, isMainFrame: navigationResponse.isForMainFrame) {
        case .allow:
            decisionHandler(.allow)
        case .cancel:
            decisionHandler(.cancel)
            if let url = navigationResponse.response.url {
                print(Self.subframeCancelLogMessage(for: url))
            }
        case .cancelAndOpenExternally:
            decisionHandler(.cancel)
            if let url = navigationResponse.response.url {
                openExternally(url)
            }
        case .cancelWithBanner:
            decisionHandler(.cancel)
            if let url = navigationResponse.response.url {
                model.banner = Self.refusalBanner(for: url)
            }
        }
    }

    public func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        let decision = NavigationPolicy.decide(url: url)
        switch Self.windowOpenOutcome(navigationType: navigationAction.navigationType, decision: decision) {
        case .allow:
            webView.load(URLRequest(url: url))
        case .cancel:
            break
        case .cancelAndOpenExternally:
            openExternally(url)
        case .cancelWithBanner:
            model.banner = Self.refusalBanner(for: url)
        }
        return nil
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        #if !canImport(UIKit)
        if let window = webView.window, window.styleMask.contains(.fullScreen) {
            webView.evaluateJavaScript("document.body.classList.add('fmshell-fullscreen')")
        }
        #endif
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        model.banner = "The page stopped responding and was reloaded."
        webView.load(URLRequest(url: lastURL))
    }

    public func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        model.banner = error.localizedDescription
    }

    public func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        guard !isPolicyCancellation(error) else { return }
        model.banner = error.localizedDescription
    }

    private func isPolicyCancellation(_ error: Error) -> Bool {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled {
            return true
        }
        if nsError.domain == "WebKitErrorDomain", nsError.code == 102 {
            return true
        }
        return false
    }

    nonisolated static func refusalBanner(for url: URL) -> String {
        guard let scheme = url.scheme else { return "Refused to open a link" }
        return "Refused to open a \(scheme): link"
    }

    nonisolated static func subframeCancelLogMessage(for url: URL) -> String {
        "Cancelled subframe response: \(url.absoluteString)"
    }
}
