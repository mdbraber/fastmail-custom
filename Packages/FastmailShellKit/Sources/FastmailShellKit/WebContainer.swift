import SwiftUI
import WebKit

@MainActor
public final class ShellModel: ObservableObject {
    @Published public var banner: String?
    @Published public var tint: String?

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

    func makeWebView(
        coordinator: WebCoordinator,
        beforeLoad: ((WKUserContentController) -> Void)? = nil,
        makeView: (WKWebViewConfiguration) -> WKWebView = { WKWebView(frame: .zero, configuration: $0) }
    ) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        let bridge = NativeBridge(
            expectedHost: profile.startURL.host ?? "",
            onLog: { message in print("[userscript] \(message)") },
            onError: { [model] message in model.show(message) },
            onTheme: { [model] color in Task { @MainActor in model.tint = color } }
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
            let injected = try ScriptInjector.userScripts(from: scripts, url: profile.startURL)
            if !injected.userScriptIncluded {
                let message = "User script @match does not cover \(profile.startURL.absoluteString)"
                Task { @MainActor in model.show(message) }
            }
            for script in injected.scripts {
                configuration.userContentController.addUserScript(script)
            }
        } catch {
            let message = "User script not loaded: \(error)"
            Task { @MainActor in model.show(message) }
        }

        beforeLoad?(configuration.userContentController)

        let webView = makeView(configuration)
        webView.isInspectable = true
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        webView.load(URLRequest(url: profile.startURL))
        return webView
    }
}
