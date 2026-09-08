import Combine
import SwiftUI
import WebKit

#if canImport(UIKit)
import UIKit
#endif

@MainActor
public final class ShellModel: ObservableObject {
    @Published public var banner: String?
    @Published public var tint: String?
    @Published public var dragRect: CGRect = .zero
    @Published public var noDragRects: [CGRect] = []
    @Published public var shareRequest: ShareRequest?
    @Published public var pendingLoad: URL?

    public init() {}

    public func show(_ message: String) {
        banner = message
    }
}

@MainActor
public struct WebContainer {
    // Fastmail's service worker hands notifications to the page instead of
    // showing them itself when it sees Electron/ in the user agent — the
    // mark of Fastmail's own desktop app. Every WKWebView that can host that
    // worker needs the same token, or a restart picks the other client and
    // starts the branch that never notifies; shared here so the two can't
    // drift apart.
    public static let electronUserAgentToken = "Electron/0.0.0 FastmailShell"

    /// Which layout the page is asked for.
    ///
    /// An iPad asks for the desktop site unless it is told otherwise. The
    /// recommended mode is the default, and on a large iPad it means
    /// desktop-class browsing: the web view reports itself as a Mac and
    /// Fastmail serves the wide layout. Mobile is what this shell wants on a
    /// touch screen, and it is what the mode's own touch surfaces are built
    /// on — the bottom action bar, and the walk back to the list when the
    /// next message is already triaged — since those follow Fastmail's own
    /// reading of whether it is on a phone. A phone is unaffected either
    /// way, because recommended already means mobile there.
    ///
    /// The Mac keeps recommended, which is the desktop layout it should have.
    static var preferredContentMode: WKWebpagePreferences.ContentMode {
        #if os(iOS)
        .mobile
        #else
        .recommended
        #endif
    }

    let profile: Profile
    let model: ShellModel
    let loader: ResourceLoading
    let loadURL: URL

    public init(
        profile: Profile,
        model: ShellModel,
        loader: ResourceLoading = BundleResourceLoader(),
        loadURL: URL? = nil
    ) {
        self.profile = profile
        self.model = model
        self.loader = loader
        self.loadURL = loadURL ?? profile.startURL
    }

    func makeWebView(
        coordinator: WebCoordinator,
        beforeLoad: ((WKUserContentController) -> Void)? = nil,
        makeView: (WKWebViewConfiguration) -> WKWebView = { WKWebView(frame: .zero, configuration: $0) }
    ) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        #if os(macOS)
        // Fastmail's service worker hands notifications to the page instead
        // of showing them itself when it sees Electron/ in the user agent —
        // the mark of Fastmail's own desktop app — and the page then calls
        // window.electron.showNotification, which the harness provides. The
        // token is what makes the worker take that branch; WKWebView cannot
        // receive push, so it is the only branch that can ever notify.
        configuration.applicationNameForUserAgent = Self.electronUserAgentToken
        #endif

        configuration.defaultWebpagePreferences.preferredContentMode =
            Self.preferredContentMode

        let bridge = NativeBridge(
            // The page this view is being built for, not the profile's
            // default: the two differ the moment a backend is chosen, and
            // a bridge expecting the wrong host refuses every message the
            // page sends.
            expectedHost: loadURL.host ?? "",
            onLog: { message in print("[userscript] \(message)") },
            onError: { [model] message in model.show(message) },
            onTheme: { [model] color in Task { @MainActor in model.tint = color } },
            onDragRegions: { [model] drag, noDrag in
                Task { @MainActor in
                    model.dragRect = drag
                    model.noDragRects = noDrag
                }
            },
            onShare: { [model] request in model.shareRequest = request },
            onBadge: { count in BadgeController.shared.apply(count) },
            onActions: { names in
                UserDefaults.standard.set(names, forKey: IntentSupport.actionNamesKey)
            },
            onOpenSettings: { SettingsPresenter.shared.open() },
            onNotify: { notification in
                #if os(macOS)
                NotificationPresenter.shared.show(notification)
                #endif
            },
            onDismissNotifications: { ids in
                #if os(macOS)
                NotificationPresenter.shared.dismiss(ids: ids)
                #endif
            },
            onShowWindow: {
                #if os(macOS)
                NotificationPresenter.shared.showWindow()
                #endif
            }
        )
        configuration.userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: "native"
        )

        // Settings go in ahead of every other script: the userscript reads
        // window.__customModeSettings the moment it starts.
        configuration.userContentController.addUserScript(
            CustomModeSettings.bootstrapScript()
        )

        do {
            let scripts = try ScriptStore(
                loader: loader,
                overlayName: profile.overlayScriptName
            ).load()
            let injected = try ScriptInjector.userScripts(from: scripts, url: loadURL)
            if !injected.userScriptIncluded {
                let message = "User script @match does not cover \(loadURL.absoluteString)"
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
        WebViewRegistry.shared.register(webView)
        webView.isInspectable = true
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        coordinator.settingsPusher = CustomModeSettingsPusher(webView: webView)
        coordinator.sharePresenter = SharePresenter(model: model, webView: webView)
        coordinator.linkLoader = LinkLoader(model: model, webView: webView)
        #if !canImport(UIKit)
        coordinator.commandRelay = CommandRelay(model: model, webView: webView)
        #endif
        coordinator.badgePuller = BadgePuller(webView: webView)
        DownloadManager.shared.onFinished = { item in
            guard let fileURL = item.fileURL else { return }
            AttachmentOpener.handle(fileURL: fileURL)
        }
        DownloadManager.shared.onIssue = { [model] message in
            model.banner = message
        }
        webView.load(URLRequest(url: loadURL))
        return webView
    }
}

public extension Notification.Name {
    static let fmshellReload = Notification.Name("fmshellReload")
    static let fmshellShare = Notification.Name("fmshellShare")
    static let fmshellCompose = Notification.Name("fmshellCompose")
}

// External URLs land in the model from onOpenURL; the web view they should
// drive only exists in here, so this relay carries them across, the same
// shape as SharePresenter.
@MainActor
final class LinkLoader {
    private weak var webView: WKWebView?
    private let model: ShellModel
    private var subscription: AnyCancellable?

    init(model: ShellModel, webView: WKWebView) {
        self.model = model
        self.webView = webView
        subscription = model.$pendingLoad
            .compactMap { $0 }
            .sink { [weak self] url in
                self?.load(url)
            }
    }

    private func load(_ url: URL) {
        model.pendingLoad = nil
        webView?.load(URLRequest(url: url))
    }
}

#if !canImport(UIKit)
// Menu-bar commands act on whichever window's web view is key. The window
// draws no native toolbar — Fastmail's own header is the chrome — so Share
// and Reload live in the menu bar and reach the page from here.
@MainActor
final class CommandRelay {
    private weak var webView: WKWebView?
    private let model: ShellModel
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []

    init(model: ShellModel, webView: WKWebView) {
        self.model = model
        self.webView = webView
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: .fmshellReload, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.ifKey { $0.reload() } }
        })
        observers.append(center.addObserver(
            forName: .fmshellShare, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.shareCurrentMessage() }
        })
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    private func ifKey(_ act: (WKWebView) -> Void) {
        guard let webView, webView.window?.isKeyWindow == true else { return }
        act(webView)
    }

    private func shareCurrentMessage() {
        ifKey { webView in
            webView.callAsyncJavaScript(
                "return await window.native.currentLink();",
                arguments: [:],
                in: nil,
                in: .page
            ) { [model] result in
                switch result {
                case .success(let value):
                    let link = value as? [String: Any]
                    // What is shared is the production address, not this
                    // shell's beta one, which opens for nobody else
                    let url = (link?["url"] as? String).flatMap(URL.init(string:)).map(Backend.canonical)
                    let title = link?["title"] as? String
                    guard url != nil || title != nil else {
                        model.banner = "No message open"
                        return
                    }
                    model.shareRequest = ShareRequest(
                        url: url, text: title, sourceRect: nil, completion: {}
                    )
                case .failure:
                    model.banner = "No message open"
                }
            }
        }
    }
}
#endif

// The page pushes badge counts as they change, but a backgrounded app misses
// those pushes, so returning to the foreground asks the page for a fresh
// count rather than trusting the last one that arrived.
@MainActor
final class BadgePuller {
    private weak var webView: WKWebView?
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []

    init(webView: WKWebView) {
        self.webView = webView
        #if canImport(UIKit)
        let name = UIApplication.didBecomeActiveNotification
        #else
        let name = NSApplication.didBecomeActiveNotification
        #endif
        observers.append(NotificationCenter.default.addObserver(
            forName: name, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.pull() }
        })
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    private func pull() {
        webView?.callAsyncJavaScript(
            "return window.native && window.native.badgeCount ? await window.native.badgeCount() : null;",
            arguments: [:],
            in: nil,
            in: .page
        ) { result in
            if case .success(let value) = result {
                BadgeController.shared.apply(value as? Int)
            }
        }
    }
}

/// Pushes changed Custom mode settings into a running page, the way the Safari
/// extension's storage listener does for its tabs. Any writer counts — the
/// macOS Settings window, the iOS Settings app — because both land in
/// UserDefaults. Coming back from the iOS Settings app is covered separately:
/// the defaults change while the app is suspended, so foregrounding pushes too.
@MainActor
final class CustomModeSettingsPusher {
    private weak var webView: WKWebView?
    // Written once in init, read again only from deinit — never concurrently
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []
    private var pushTask: Task<Void, Never>?

    init(webView: WKWebView) {
        self.webView = webView
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.schedulePush() }
        })
        #if canImport(UIKit)
        observers.append(center.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.schedulePush() }
        })
        #endif
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // Applying settings makes the page drop caches and re-ask the server for
    // counts, so a keystroke-by-keystroke stream of changes is coalesced into
    // one push once the writing pauses.
    private func schedulePush() {
        pushTask?.cancel()
        pushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            self?.webView?.evaluateJavaScript(
                CustomModeSettings.applyScriptSource(),
                completionHandler: nil
            )
        }
    }
}
