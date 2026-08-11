import SwiftUI
import WebKit

@MainActor
public final class ShellModel: ObservableObject {
    @Published public var banner: String?

    public init() {}

    public func show(_ message: String) {
        banner = message
    }
}

@MainActor
public struct WebContainer {
    let profile: Profile
    let model: ShellModel

    public init(profile: Profile, model: ShellModel) {
        self.profile = profile
        self.model = model
    }

    func makeWebView(coordinator: WebCoordinator) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        let bridge = NativeBridge(
            onLog: { message in print("[userscript] \(message)") },
            onError: { [model] message in model.show(message) }
        )
        configuration.userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: "native"
        )

        let loader = BundleResourceLoader(bundles: [.main, .module])
        do {
            let scripts = try ScriptStore(
                loader: loader,
                overlayName: profile.overlayScriptName
            ).load()
            for script in try ScriptInjector.userScripts(from: scripts, url: profile.startURL) {
                configuration.userContentController.addUserScript(script)
            }
        } catch {
            let message = "User script not loaded: \(error)"
            Task { @MainActor in model.show(message) }
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = true
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        webView.load(URLRequest(url: profile.startURL))
        return webView
    }
}
