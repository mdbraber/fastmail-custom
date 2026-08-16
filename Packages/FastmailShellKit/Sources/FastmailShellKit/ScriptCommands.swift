#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import WebKit

extension NSWindow {
    var webViewForScripting: WKWebView? {
        WebViewRegistry.shared.views.first { $0.window === self }
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
