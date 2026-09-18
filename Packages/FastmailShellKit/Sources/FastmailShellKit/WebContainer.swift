import Combine
import SwiftUI
import WebKit

#if canImport(UIKit)
import UIKit
#endif

/// What the page says it looks like: the colour to paint the window with, and
/// whether Fastmail calls its own theme dark.
public struct PageTint: Equatable, Sendable {
    public let color: String
    public let isDark: Bool?

    public init(color: String, isDark: Bool?) {
        self.color = color
        self.isDark = isDark
    }
}

@MainActor
public final class ShellModel: ObservableObject {
    /// A message shown in this app's own banner rather than Fastmail's
    /// toast, for when there is no live page left to ask: a crashed web
    /// content process, a failed load, or an error from before the page
    /// even exists. Everything else routes through PageToast instead.
    @Published public var banner: String?
    @Published public var tint: PageTint?
    @Published public var dragRect: CGRect = .zero
    @Published public var noDragRects: [CGRect] = []
    @Published public var shareRequest: ShareRequest?
    @Published public var pendingLoad: URL?
    /// A page action waiting for the page to be able to answer.
    @Published public var pendingAction: String?
    /// The page this window is showing, and the message on it when there is
    /// one. Watched so the page can be offered to another device.
    @Published public var pageURL: URL?
    @Published public var pageSubject: String?

    public init() {}

    public func show(_ message: String) {
        banner = message
    }
}

/// A message shown Fastmail's own way, through the toast host its own
/// archive verbs raise, reached the way harness.js already reaches it for
/// its own fault reporting. Used for anything that happens with a page
/// still alive to ask, so nothing here draws chrome of its own.
@MainActor
public enum PageToast {
    public static func show(_ message: String, duration: TimeInterval = 4) {
        guard let view = WebViewRegistry.shared.active else { return }
        let script = """
        window.__fmshell && window.__fmshell.toast(\(Self.jsonString(message)), \(Int(duration * 1000)));
        """
        view.evaluateJavaScript(script)
    }

    private static func jsonString(_ text: String) -> String {
        guard
            let data = try? JSONEncoder().encode(text),
            let json = String(data: data, encoding: .utf8)
        else { return "\"\"" }
        return json
    }
}

@MainActor
public struct WebContainer {
    // Fastmail's service worker hands notifications to the page instead of
    // showing them itself when it sees Electron/ in the user agent; the mark
    // of Fastmail's own desktop app.
    public static let electronUserAgentToken = "Electron/0.0.0 FastmailShell"

    /// Which layout the page is asked for. An iPad asks for the desktop site
    /// unless it is told otherwise.
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
        // Fastmail's service worker hands notifications to the page instead of
        // showing them itself when it sees Electron/ in the user agent, the
        // mark of Fastmail's own desktop app, and the page then calls
        // window.electron.showNotification, which the harness provides.
        configuration.applicationNameForUserAgent = Self.electronUserAgentToken
        #endif

        configuration.defaultWebpagePreferences.preferredContentMode =
            Self.preferredContentMode

        let bridge = NativeBridge(
            // The page this view is being built for, not the profile's
            // default: the two differ the moment a backend is chosen, and a
            // bridge expecting the wrong host refuses every message the page
            // sends.
            expectedHost: loadURL.host ?? "",
            onLog: { message in print("[userscript] \(message)") },
            onError: { message in PageToast.show(message) },
            onTheme: { [model] color, isDark in
                Task { @MainActor in model.tint = PageTint(color: color, isDark: isDark) }
            },
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
            onSetting: { key, value in
                UserDefaults.standard.set(value, forKey: FastmailCustomSettings.defaultsKey(for: key))
                // Saved first; iCloud gets it once this account has joined
                FastmailCustomSettingsSync.current?.localChanged(key: key, value: value)
                #if canImport(UIKit)
                // The home-screen quick actions are built from the badge
                // label. They are rebuilt when the app comes forward, which
                // was enough while the label was only editable in the iOS
                // Settings app; now that it is editable without leaving the
                // app, they have to be rebuilt here too.
                if key == "appBadgeLabel" { HomeShortcuts.refresh() }
                #endif
            },
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
            },
            onSubject: { [model] subject in model.pageSubject = subject },
            onCompose: { asked in
                #if os(macOS)
                return ComposeCommands.open(asked: asked)
                #else
                // A phone has one window and no tabs; every message is written
                // in the page.
                return ComposeMode.inline.rawValue
                #endif
            },
            onEditDraft: { id in
                #if os(macOS)
                return ComposeCommands.editDraft(id: id)
                #else
                // A phone writes every message in the page, which is where
                // Fastmail opens a draft anyway.
                return ComposeMode.leaveItToFastmail
                #endif
            },
            // The Notifications page exists on iPhone and iPad only; the Mac
            // keeps Fastmail's own and answers nothing
            onNotificationState: {
                #if canImport(UIKit)
                return await NotificationSettings.state()
                #else
                return nil
                #endif
            },
            onSetNotifications: { choice in
                #if canImport(UIKit)
                return NotificationSettings.save(choice)
                #else
                return nil
                #endif
            },
            onOpenNotificationSettings: {
                #if canImport(UIKit)
                NotificationSettings.openSystemSettings()
                #endif
            },
            // The Mac draws its own banners, so its previews switch is the
            // app's alone; the phone's goes with its notification choice
            onNotificationPreviews: { enabled in
                #if os(macOS)
                if let enabled { PushPreferences.setPreviews(enabled) }
                return PushPreferences.previews()
                #else
                return nil
                #endif
            },
            // And the Mac's excluded labels, which Fastmail's own choices
            // have no room for; the page leaves out what they catch
            onNotificationExclusions: { ids in
                #if os(macOS)
                if let ids { PushPreferences.setExcludedMailboxIds(ids) }
                return PushPreferences.excludedMailboxIds()
                #else
                return nil
                #endif
            },
            // Settings sync, where the app installed it; nothing happens
            // without it
            onAccount: { accountId in
                FastmailCustomSettingsSync.current?.accountReported(accountId)
            },
            onSettingsSync: { enabled in
                FastmailCustomSettingsSync.current?.setEnabled(enabled)
            },
            // A WKWebView's own window.Notification cannot be granted, so the
            // harness shims it on the Mac and asks here instead.
            onNotificationPermission: {
                #if os(macOS)
                return await NotificationPresenter.shared.permissionStatus()
                #else
                return "denied"
                #endif
            },
            onRequestNotificationPermission: {
                #if os(macOS)
                return await NotificationPresenter.shared.requestPermission()
                #else
                return "denied"
                #endif
            },
            // Fastmail's desktop module describes the Mac's File and View
            // menus and prints through the app
            onMenu: { menu, view in
                #if os(macOS)
                if let view { PageMenus.shared.set(PageMenu.parse(menu), for: view) }
                #endif
            },
            onPrint: { view in
                #if os(macOS)
                if let view { await PagePrinter.print(view) }
                #endif
            },
            onPrintToPDF: { view in
                #if os(macOS)
                if let view {
                    await PagePrinter.exportPDF(view, suggestedName: WebViewRegistry.shared.subject(for: view))
                }
                #endif
            },
            onFocusWindow: { name in
                #if os(macOS)
                return await WindowFocus.focus(named: name)
                #else
                return false
                #endif
            }
        )
        configuration.userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: "native"
        )

        // Settings go in ahead of every other script: the userscript reads
        // window.__fastmailCustomSettings the moment it starts.
        // With the sync switch's state where the app can sync, so the page
        // draws the switch from the start
        configuration.userContentController.addUserScript(
            FastmailCustomSettings.bootstrapScript(syncEnabled: FastmailCustomSettingsSync.current?.isEnabled)
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
        // Always on the Mac; on iPhone and iPad, the Enable remote debugging
        // switch on the Backend page.
        webView.isInspectable = WebInspection.isAllowed()
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        coordinator.settingsPusher = FastmailCustomSettingsPusher(
            webView: webView,
            syncEnabled: { FastmailCustomSettingsSync.current?.isEnabled }
        )
        coordinator.sharePresenter = SharePresenter(model: model, webView: webView)
        coordinator.linkLoader = LinkLoader(model: model, webView: webView)
        coordinator.actionRunner = ActionRunner(model: model, webView: webView)
        coordinator.pageWatcher = PageWatcher(model: model, webView: webView)
        #if !canImport(UIKit)
        coordinator.commandRelay = CommandRelay(model: model, webView: webView)
        coordinator.continuityBeacon = ContinuityBeacon(
            model: model, webView: webView, appName: profile.displayName
        )
        #endif
        coordinator.badgePuller = BadgePuller(webView: webView)
        DownloadManager.shared.onFinished = { item in
            guard let fileURL = item.fileURL else { return }
            AttachmentOpener.handle(fileURL: fileURL)
        }
        DownloadManager.shared.onIssue = { message in
            PageToast.show(message)
        }
        webView.load(URLRequest(url: loadURL))
        return webView
    }
}

public extension Notification.Name {
    static let fmshellReload = Notification.Name("fmshellReload")
    static let fmshellShare = Notification.Name("fmshellShare")
    static let fmshellCompose = Notification.Name("fmshellCompose")
    static let fmshellComposeInTab = Notification.Name("fmshellComposeInTab")
    static let fmshellInspect = Notification.Name("fmshellInspect")
    static let fmshellCopyURL = Notification.Name("fmshellCopyURL")
    static let fmshellCopyTitle = Notification.Name("fmshellCopyTitle")
    static let fmshellCopyMarkdownLink = Notification.Name("fmshellCopyMarkdownLink")
    static let fmshellSearch = Notification.Name("fmshellSearch")
}

/// A page action asked for from outside, run against the web view once the
/// page can answer it. The same relay shape as LinkLoader, for the half of
/// what a shortcut can ask for that no address reaches.
@MainActor
final class ActionRunner {
    private weak var webView: WKWebView?
    private let model: ShellModel
    private var subscription: AnyCancellable?

    /// Long enough for a cold launch to reach a drawn mailbox, and short
    /// enough that a shortcut nobody can serve gives up rather than firing
    /// into whatever the page becomes a minute later.
    private static let tries = 40
    private static let wait = 0.25

    init(model: ShellModel, webView: WKWebView) {
        self.model = model
        self.webView = webView
        subscription = model.$pendingAction
            .compactMap { $0 }
            .sink { [weak self] name in
                self?.run(name, tries: Self.tries)
            }
    }

    /// The page is asked rather than waited for. A shortcut can be what
    /// launches the app, and then this arrives before Fastmail has drawn
    /// anything to act on; so a refusal is tried again for a few seconds and
    /// then let go, quietly, since by then nobody is looking for it.
    private func run(_ name: String, tries: Int) {
        model.pendingAction = nil
        guard let webView, tries > 0 else { return }

        webView.callAsyncJavaScript(
            "return await window.native.runAction(name);",
            arguments: ["name": name],
            in: nil,
            in: .page
        ) { [weak self] result in
            guard case .failure = result else { return }
            MainActor.assumeIsolated {
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.wait) {
                    MainActor.assumeIsolated { self?.run(name, tries: tries - 1) }
                }
            }
        }
    }
}

// External URLs land in the model from onOpenURL; the web view they should
// drive only exists in here, so this relay carries them across, the same shape
// as SharePresenter.
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
        guard let webView else { return }
        guard let step = Self.step(from: webView.url, to: url) else {
            webView.load(URLRequest(url: url))
            return
        }
        webView.callAsyncJavaScript(
            Self.stepScript,
            arguments: ["path": step],
            in: nil,
            in: .page
        ) { result in
            // The page answers false when it is not the mail app: a login
            // screen, or an app that has not started yet. Then it is loaded.
            let steered = (try? result.get()) as? Bool ?? false
            guard !steered else { return }
            MainActor.assumeIsolated {
                webView.load(URLRequest(url: url))
            }
        }
    }

    /// The step inside the page that reaches `target`, or nothing when the
    /// page has to be loaded. Fastmail's router takes a pushed address and
    /// swaps the view, exactly as it does for a link clicked in the page;
    /// loading throws away the running app and builds it again.
    nonisolated static func step(from current: URL?, to target: URL) -> String? {
        guard
            let current,
            let here = URLComponents(url: current, resolvingAgainstBaseURL: false),
            let there = URLComponents(url: target, resolvingAgainstBaseURL: false),
            here.scheme?.lowercased() == "https",
            there.scheme?.lowercased() == "https",
            let host = there.host,
            LinkRouter.isFastmailHost(host),
            here.host?.caseInsensitiveCompare(host) == .orderedSame,
            // A message to write is handed over whole; the router opens no
            // window for a pushed compose address.
            !(there.queryItems ?? []).contains(where: { $0.name == "mailto" })
        else { return nil }
        var step = there.path.isEmpty ? "/" : there.path
        if let query = there.query, !query.isEmpty { step += "?" + query }
        if let fragment = there.fragment, !fragment.isEmpty { step += "#" + fragment }
        return step
    }

    /// Pushed rather than assigned to `location`, which would load the page.
    /// The popstate is what the router listens for, the same event the back
    /// button sends.
    nonisolated static let stepScript = """
    if (!window.FastMail || !window.FastMail.store) { return false; }
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return true;
    """
}

/// Fastmail moves between mailboxes and messages without loading anything, so
/// the address is watched rather than read once when a page finishes.
@MainActor
final class PageWatcher {
    private var observation: NSKeyValueObservation?

    init(model: ShellModel, webView: WKWebView) {
        observation = webView.observe(\.url, options: [.initial, .new]) { [weak model] view, _ in
            MainActor.assumeIsolated {
                model?.pageURL = view.url
            }
        }
    }
}

#if !canImport(UIKit)
// Menu-bar commands act on whichever window's web view is key.
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
        observers.append(center.addObserver(
            forName: .fmshellInspect, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.openInspector() }
        })
        // What the Shortcuts actions offer, from the menu bar as well
        observers.append(center.addObserver(
            forName: .fmshellCopyURL, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.copyCurrentLink(.url) }
        })
        observers.append(center.addObserver(
            forName: .fmshellCopyTitle, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.copyCurrentLink(.title) }
        })
        observers.append(center.addObserver(
            forName: .fmshellCopyMarkdownLink, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.copyCurrentLink(.markdown) }
        })
        observers.append(center.addObserver(
            forName: .fmshellSearch, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.runPageAction(named: "search") }
        })
    }

    enum LinkPart {
        case url, title, markdown

        var done: String {
            switch self {
            case .url: return "Copied URL"
            case .title: return "Copied title"
            case .markdown: return "Copied Markdown link"
            }
        }
    }

    // Read the way Get URL, Get Title and Get Current Link read it, so the
    // address copied is the same canonical one they hand back; and when
    // there is nothing to read, the line says what they would have said.
    private func copyCurrentLink(_ part: LinkPart) {
        ifKey { webView in
            Task { @MainActor in
                do {
                    let link = try await IntentSupport.currentLink(in: webView)
                    let text: String
                    switch part {
                    case .url: text = link.url.absoluteString
                    case .title: text = link.title
                    case .markdown: text = link.markdown
                    }
                    let pasteboard = NSPasteboard.general
                    pasteboard.clearContents()
                    pasteboard.setString(text, forType: .string)
                    PageToast.show(part.done)
                } catch let error as IntentSupportError {
                    PageToast.show(error.message)
                } catch {
                    PageToast.show(error.localizedDescription)
                }
            }
        }
    }

    // A script action, as Run Script Action runs it
    private func runPageAction(named name: String) {
        ifKey { webView in
            Task { @MainActor in
                do {
                    try await IntentSupport.runAction(named: name, in: webView)
                } catch let error as IntentSupportError {
                    PageToast.show(error.message)
                } catch {
                    PageToast.show(error.localizedDescription)
                }
            }
        }
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

    // The inspector is reached through a private name, so it can go away
    // under us; better a line saying it has than a menu item that does
    // nothing and explains nothing.
    private func openInspector() {
        ifKey { webView in
            if !WebInspector.open(for: webView) {
                PageToast.show("This build of WebKit will not open the inspector")
            }
        }
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
                        PageToast.show("No message open")
                        return
                    }
                    model.shareRequest = ShareRequest(
                        url: url, text: title, sourceRect: nil, completion: {}
                    )
                case .failure:
                    PageToast.show("No message open")
                }
            }
        }
    }
}
#endif

// The page pushes badge counts as they change, but a backgrounded app misses
// those pushes, so returning to the foreground asks the page for a fresh count
// rather than trusting the last one that arrived.
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

/// Pushes changed Fastmail Custom settings into a running page, the way the Safari
/// extension's storage listener does for its tabs.
@MainActor
final class FastmailCustomSettingsPusher {
    private weak var webView: WKWebView?
    /// Whether the app's sync switch is on, or nothing where the app cannot
    /// sync. Asked afresh for every push.
    private let syncEnabled: @MainActor () -> Bool?
    // Written once in init, read again only from deinit; never concurrently
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []
    private var pushTask: Task<Void, Never>?
    /// The script last pushed into the running page, settings and switch
    /// together, or nothing while it has only what it was built with.
    private var pushed: String?
    /// Whether the push waiting to go was asked for regardless of change.
    private var forceNext = false

    init(webView: WKWebView, syncEnabled: @escaping @MainActor () -> Bool? = { nil }) {
        self.webView = webView
        self.syncEnabled = syncEnabled
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.schedulePush(force: false) }
        })
        #if canImport(UIKit)
        observers.append(center.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.schedulePush(force: true) }
        })
        #endif
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// A new document was loaded, with the settings the view was built with.
    func pageLoaded() {
        pushed = nil
    }

    /// Every defaults write posts the same notification, the shell's own keys
    /// included, and the iPhone and iPad apps write one each time the page
    /// changes while Remember last viewed page is on. A push the page already
    /// has would only make it drop its caches again.
    nonisolated static func shouldPush(_ settings: String, after pushed: String?, force: Bool) -> Bool {
        force || settings != pushed
    }

    // Applying settings makes the page drop caches and re-ask the server for
    // counts, so a keystroke-by-keystroke stream of changes is coalesced into
    // one push once the writing pauses.
    private func schedulePush(force: Bool) {
        forceNext = forceNext || force
        pushTask?.cancel()
        pushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled, let self else { return }
            // The whole script is compared, not the settings alone: the sync
            // switch lives outside them, and a flip made in one window has to
            // reach the others
            let script = FastmailCustomSettings.applyScriptSource(from: .standard, syncEnabled: self.syncEnabled())
            let force = self.forceNext
            self.forceNext = false
            guard Self.shouldPush(script, after: self.pushed, force: force) else { return }
            self.pushed = script
            self.webView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }
}
