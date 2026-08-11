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
    let loader: ResourceLoading

    public init(
        profile: Profile,
        model: ShellModel,
        loader: ResourceLoading = BundleResourceLoader()
    ) {
        self.profile = profile
        self.model = model
        self.loader = loader
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

        do {
            let scripts = try ScriptStore(
                loader: loader,
                overlayName: profile.overlayScriptName
            ).load()
            let userScripts = try ScriptInjector.userScripts(from: scripts, url: profile.startURL)
            if userScripts.count == 1 {
                model.show("User script @match does not cover \(profile.startURL.absoluteString)")
            }
            for script in userScripts {
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
