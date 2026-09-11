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
    /// Whether the app is the one you are looking at.
    private let isInFront: @MainActor () -> Bool
    // Keeps the settings observer alive exactly as long as the view exists
    var settingsPusher: CustomModeSettingsPusher?
    var sharePresenter: SharePresenter?
    var badgePuller: BadgePuller?
    var linkLoader: LinkLoader?
    var actionRunner: ActionRunner?
    var pageWatcher: PageWatcher?
    #if !canImport(UIKit)
    var commandRelay: CommandRelay?
    var continuityBeacon: ContinuityBeacon?
    #endif

    public init(
        model: ShellModel,
        startURL: URL,
        openExternally: @escaping @MainActor (URL) -> Void = { url in
            #if canImport(UIKit)
            UIApplication.shared.open(url)
            #else
            NSWorkspace.shared.open(url)
            #endif
        },
        isInFront: @escaping @MainActor () -> Bool = {
            #if canImport(UIKit)
            UIApplication.shared.applicationState == .active
            #else
            NSApplication.shared.isActive
            #endif
        }
    ) {
        self.model = model
        self.lastURL = startURL
        self.openExternally = openExternally
        self.isInFront = isInFront
    }

    enum FrameOutcome: Equatable {
        case allow
        case cancel
        case cancelAndOpenExternally
        case cancelWithBanner
        /// A page asking for a window of its own; "Open in new window" on a
        /// message or a draft; which is given one rather than being made to
        /// take over the window it was asked from.
        case openInWindow
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

    /// Fastmail's own windows are always given one: it asks for them in more
    /// ways than a link click, and "Open in new window" is the app being used
    /// rather than a page springing something on you.
    nonisolated static func windowOpenOutcome(
        navigationType: WKNavigationType,
        decision: NavigationDecision
    ) -> FrameOutcome {
        let clicked = navigationType == .linkActivated
        switch decision {
        case .allow:
            return .openInWindow
        case .openExternally, .download:
            return clicked ? .cancelAndOpenExternally : .cancel
        case .refuse:
            return clicked ? .cancelWithBanner : .cancel
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
        case .allow, .openInWindow:
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
            contentDisposition: contentDisposition,
            host: navigationResponse.response.url?.host,
            isMainFrame: navigationResponse.isForMainFrame
        )
        if decision == .download {
            decisionHandler(.download)
            return
        }
        switch Self.outcome(for: decision, isMainFrame: navigationResponse.isForMainFrame) {
        case .allow, .openInWindow:
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
        navigationResponse: WKNavigationResponse,
        didBecome download: WKDownload
    ) {
        DownloadManager.shared.adopt(download)
    }

    public func webView(
        _ webView: WKWebView,
        navigationAction: WKNavigationAction,
        didBecome download: WKDownload
    ) {
        DownloadManager.shared.adopt(download)
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
        case .openInWindow:
            #if canImport(UIKit)
            // One window is all there is on a phone.
            webView.load(URLRequest(url: url))
            #else
            return ComposeWindows.shared.window(
                for: configuration,
                size: Self.windowSize(windowFeatures)
            )
            #endif
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

    /// The page's own process has gone. Reload either way; say so only when
    /// you were looking at it.
    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if isInFront() {
            model.banner = "The page stopped responding and was reloaded."
        }
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

    // MARK: JavaScript dialogs
    //
    // Fastmail asks through alert/confirm/prompt in a handful of flows,
    // deleting a rule confirms first, for one. WKWebView renders none of
    // them unless the UI delegate presents them itself; without these, a
    // confirm() silently answers "no" and the action looks like it simply
    // did not work.

    public func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor () -> Void
    ) {
        #if canImport(UIKit)
        guard let presenter = Self.topViewController(for: webView) else {
            completionHandler()
            return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presenter.present(alert, animated: true)
        #else
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        if let window = webView.window {
            alert.beginSheetModal(for: window) { _ in completionHandler() }
        } else {
            _ = alert.runModal()
            completionHandler()
        }
        #endif
    }

    public func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor (Bool) -> Void
    ) {
        #if canImport(UIKit)
        guard let presenter = Self.topViewController(for: webView) else {
            completionHandler(false)
            return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presenter.present(alert, animated: true)
        #else
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        if let window = webView.window {
            alert.beginSheetModal(for: window) { response in
                completionHandler(response == .alertFirstButtonReturn)
            }
        } else {
            completionHandler(alert.runModal() == .alertFirstButtonReturn)
        }
        #endif
    }

    public func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping @MainActor (String?) -> Void
    ) {
        #if canImport(UIKit)
        guard let presenter = Self.topViewController(for: webView) else {
            completionHandler(nil)
            return
        }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text ?? "")
        })
        presenter.present(alert, animated: true)
        #else
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        let finish: @MainActor (NSApplication.ModalResponse) -> Void = { response in
            completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
        }
        if let window = webView.window {
            alert.beginSheetModal(for: window, completionHandler: finish)
        } else {
            finish(alert.runModal())
        }
        #endif
    }

    #if canImport(UIKit)
    private static func topViewController(for webView: WKWebView) -> UIViewController? {
        var top = webView.window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
    #endif

    #if !canImport(UIKit)
    /// The size the page asked for, where it asked for one, and a size a
    /// message reads comfortably at where it did not.
    nonisolated static func windowSize(_ features: WKWindowFeatures) -> NSSize {
        NSSize(
            width: features.width?.doubleValue ?? ComposeWindows.ownSize.width,
            height: features.height?.doubleValue ?? ComposeWindows.ownSize.height
        )
    }
    #endif

    nonisolated static func refusalBanner(for url: URL) -> String {
        guard let scheme = url.scheme else { return "Refused to open a link" }
        return "Refused to open a \(scheme): link"
    }

    nonisolated static func subframeCancelLogMessage(for url: URL) -> String {
        "Cancelled subframe response: \(url.absoluteString)"
    }
}
