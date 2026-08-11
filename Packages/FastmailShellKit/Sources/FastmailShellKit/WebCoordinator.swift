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
        guard targetFrame.isMainFrame else {
            switch decision {
            case .allow:
                decisionHandler(.allow)
            case .openExternally, .download:
                decisionHandler(.cancel)
            }
            return
        }
        switch decision {
        case .allow:
            lastURL = url
            decisionHandler(.allow)
        case .openExternally, .download:
            decisionHandler(.cancel)
            openExternally(url)
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
        switch decision {
        case .allow:
            decisionHandler(.allow)
        case .openExternally, .download:
            decisionHandler(.cancel)
            if let url = navigationResponse.response.url {
                openExternally(url)
            }
        }
    }

    public func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            switch NavigationPolicy.decide(url: url) {
            case .allow: webView.load(URLRequest(url: url))
            case .openExternally, .download: openExternally(url)
            }
        }
        return nil
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
}
