import Foundation

#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import WebKit

extension NSWindow {
    /// The page a script talks to: a mail window's own, or the page in a
    /// compose or pop-out window, which never joins the registry.
    var webViewForScripting: WKWebView? {
        mailWebView ?? ComposeWindows.webView(of: self)
    }

    private var mailWebView: WKWebView? {
        WebViewRegistry.shared.views.first { $0.window === self }
    }

    /// What the window is for, as a four-letter code the dictionary's
    /// window kind enumeration names.
    @objc var fmKind: FourCharCode {
        ScriptWindowKind.of(
            isMailWindow: mailWebView != nil,
            hasPage: webViewForScripting != nil,
            url: webViewForScripting?.url
        ).code
    }

    /// Closes the way the close button does, so a compose window goes back
    /// to the pool. A window that is not on screen is the pool's spare and
    /// is left alone.
    @objc func fmClose(_ command: NSScriptCommand) -> Any? {
        guard isVisible || isMiniaturized else {
            command.scriptErrorNumber = NSReceiversCantHandleCommandScriptError
            command.scriptErrorString = "That window is not open."
            return nil
        }
        performClose(nil)
        return nil
    }

    @objc var fmURL: String {
        webViewForScripting?.url?.absoluteString ?? ""
    }

    @objc var fmName: String {
        guard let view = webViewForScripting else { return title }
        if let subject = WebViewRegistry.shared.subject(for: view), !subject.isEmpty {
            return subject
        }
        if let pageTitle = view.title, !pageTitle.isEmpty {
            return pageTitle
        }
        return title
    }
}

@objc(FMShellDoJavaScriptCommand)
final class DoJavaScriptCommand: NSScriptCommand {
    override func performDefaultImplementation() -> Any? {
        nonisolated(unsafe) let command = self
        MainActor.assumeIsolated {
            command.run()
        }
        return nil
    }

    @MainActor
    private func run() {
        guard let script = directParameter as? String, !script.isEmpty else {
            scriptErrorNumber = NSRequiredArgumentsMissingScriptError
            scriptErrorString = "do JavaScript needs a script."
            return
        }
        let window = evaluatedArguments?["Window"] as? NSWindow
        if window != nil && window?.webViewForScripting == nil {
            scriptErrorNumber = NSReceiversCantHandleCommandScriptError
            scriptErrorString = "That window has no Fastmail page."
            return
        }
        let view = window?.webViewForScripting ?? WebViewRegistry.shared.active
        guard let view else {
            scriptErrorNumber = NSReceiversCantHandleCommandScriptError
            scriptErrorString = "No Fastmail window is open."
            return
        }
        suspendExecution()
        view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let value):
                self.resumeExecution(withResult: IntentSupport.text(from: value))
            case .failure(let error):
                self.scriptErrorNumber = NSInternalScriptError
                self.scriptErrorString = error.localizedDescription
                self.resumeExecution(withResult: nil)
            }
        }
    }
}
#endif

/// The kinds of window a script can tell apart: a mail window, a message
/// Fastmail popped out into a window of its own, a compose window, the
/// pool's hidden spare among them, and the app's own windows with no page,
/// Downloads and Settings.
enum ScriptWindowKind: Equatable {
    case main
    case popOut
    case compose
    case other

    static func of(isMailWindow: Bool, hasPage: Bool, url: URL?) -> ScriptWindowKind {
        if isMailWindow { return .main }
        guard hasPage else { return .other }
        let path = url?.path ?? ""
        return path.hasSuffix("/compose") || path.contains("/compose/") ? .compose : .popOut
    }

    /// The codes Fastmail.sdef gives the enumerators
    var code: FourCharCode {
        switch self {
        case .main: return 0x464B_6D61   // FKma
        case .popOut: return 0x464B_706F // FKpo
        case .compose: return 0x464B_636F // FKco
        case .other: return 0x464B_6F74   // FKot
        }
    }
}
