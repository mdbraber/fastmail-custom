#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import SwiftUI
import WebKit
import Combine

/// Handoff on the Mac. A window is what carries a user activity here, so the
/// activity is hung on the window and made current whenever the page changes.
/// SwiftUI's own modifier fills an activity in but never publishes it, which
/// left another device offering the page in a browser instead of the app.
@MainActor
final class ContinuityBeacon {
    private let activity: NSUserActivity?
    private let appName: String
    private weak var webView: WKWebView?
    private var subscription: AnyCancellable?

    init(model: ShellModel, webView: WKWebView, appName: String) {
        self.appName = appName
        self.webView = webView
        activity = Continuity.activityType(bundleID: Bundle.main.bundleIdentifier)
            .map(NSUserActivity.init(activityType:))
        subscription = model.$pageURL
            .combineLatest(model.$pageSubject)
            .sink { [weak self] url, subject in
                self?.offer(url, subject: subject)
            }
    }

    private func offer(_ url: URL?, subject: String?) {
        guard let activity, let page = Continuity.advertised(url) else { return }
        Continuity.describe(
            activity,
            url: page,
            title: Continuity.title(subject: subject, fallback: appName)
        )
        activity.needsSave = true
        // The window keeps it alive and current as windows come forward; the
        // call below covers the first page, before there is a window.
        webView?.window?.userActivity = activity
        activity.becomeCurrent()
    }
}

extension WebContainer: NSViewRepresentable {
    public func makeCoordinator() -> WebCoordinator {
        WebCoordinator(model: model, startURL: loadURL)
    }

    public func makeNSView(context: Context) -> WKWebView {
        makeWebView(
            coordinator: context.coordinator,
            beforeLoad: { controller in installChromeCSS(in: controller) },
            makeView: { configuration in
                let view = WindowAwareWebView(frame: .zero, configuration: configuration)
                view.dragRegion.model = model
                view.onDidMoveToWindow = { [weak view, model] in
                    guard let view, let window = view.window else { return }
                    configureWindow(window)
                    observeFullScreen(window, webView: view, model: model)
                }
                return view
            }
        )
    }

    public func updateNSView(_ nsView: WKWebView, context: Context) {}

    private func installChromeCSS(in controller: WKUserContentController) {
        guard
            let bundle = try? ScriptStore(loader: loader, overlayName: profile.overlayScriptName).load(),
            let chromeCSS = bundle.chromeCSS,
            let injected = try? ScriptInjector.userScripts(from: bundle, url: loadURL, chromeCSS: chromeCSS),
            let styleScript = injected.styleScript
        else { return }
        controller.addUserScript(styleScript)
    }
}

@MainActor
final class WindowAwareWebView: WKWebView {
    var onDidMoveToWindow: (() -> Void)?
    let dragRegion = TitlebarDragView()

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if dragRegion.superview !== self {
            dragRegion.frame = bounds
            dragRegion.autoresizingMask = [.width, .height]
            addSubview(dragRegion)
        }
        onDidMoveToWindow?()
    }
}

@MainActor
final class TitlebarDragView: NSView {
    static let inset: CGFloat = 78
    static let titlebarHeight: CGFloat = 52
    static let topStrip: CGFloat = 10

    weak var model: ShellModel?

    override var mouseDownCanMoveWindow: Bool { true }

    static func isDraggable(
        _ point: NSPoint,
        in size: NSSize,
        drag: CGRect,
        noDrag: [CGRect],
        fullScreen: Bool
    ) -> Bool {
        guard !fullScreen else { return false }
        let inPage = CGPoint(x: point.x, y: size.height - point.y)
        guard !drag.isEmpty else { return fallbackIsDraggable(inPage) }
        guard drag.contains(inPage) else { return false }
        return !noDrag.contains { $0.contains(inPage) }
    }

    static func fallbackIsDraggable(_ inPage: CGPoint) -> Bool {
        guard inPage.y >= 0, inPage.y <= titlebarHeight else { return false }
        if inPage.y <= topStrip { return true }
        return inPage.x <= inset
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        let fullScreen = window?.styleMask.contains(.fullScreen) ?? false
        let draggable = Self.isDraggable(
            local,
            in: bounds.size,
            drag: model?.dragRect ?? .zero,
            noDrag: model?.noDragRects ?? [],
            fullScreen: fullScreen
        )
        return draggable ? self : nil
    }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

@MainActor
func configureWindow(_ window: NSWindow) {
    window.styleMask.insert(.fullSizeContentView)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    // Asked for as a tab: joining now, before the window is ordered in, is
    // what keeps a separate one from flashing up first.
    if ShellWindows.takeTabPreference() {
        window.tabbingMode = .preferred
    }
    raiseTitlebar(of: window)
}

/// Set the window buttons into Fastmail's header rather than leaving them in
/// the title bar the window would otherwise have.
@MainActor
func raiseTitlebar(of window: NSWindow) {
    window.toolbarStyle = .unified
    guard window.toolbar == nil else { return }
    let toolbar = NSToolbar(identifier: "fmshell.titlebar")
    toolbar.showsBaselineSeparator = false
    toolbar.allowsUserCustomization = false
    window.toolbar = toolbar
}

@MainActor
func applyTint(_ value: String, isDark: Bool?, to window: NSWindow) {
    guard let rgb = ThemeColor.components(from: value) else { return }
    // Only Fastmail can say whether its theme is dark; a sampled colour cannot
    // be asked.
    if let isDark {
        window.appearance = NSAppearance(named: isDark ? .darkAqua : .aqua)
    }
    let color = NSColor(srgbRed: rgb.0, green: rgb.1, blue: rgb.2, alpha: 1)
    window.backgroundColor = color
    PageChrome.record(color: color, appearance: window.appearance)
    window.contentView?.superview?.needsDisplay = true
    window.invalidateShadow()
}

/// What the pages have asked their windows to look like, kept so that a window
/// with no page of its own; one holding a message being written; can be
/// dressed to match the rest of the app rather than guessing at a colour.
@MainActor
enum PageChrome {
    private(set) static var color: NSColor?
    private(set) static var appearance: NSAppearance?

    static func record(color: NSColor, appearance: NSAppearance?) {
        self.color = color
        self.appearance = appearance
    }
}

/// How far the window's chrome reaches down over the content: the title bar
/// and its toolbar, plus the tab bar when there is one.
@MainActor
func contentTopInset(of window: NSWindow) -> CGFloat {
    guard let content = window.contentView else { return 0 }
    return max(0, content.bounds.height - window.contentLayoutRect.maxY)
}

/// How far down the page has to start. Normally nothing: the header is meant
/// to show through the transparent title bar, with the window buttons set into
/// it.
@MainActor
func tabbedPageInset(of window: NSWindow) -> CGFloat {
    guard window.tabGroup?.isTabBarVisible == true else { return 0 }
    return contentTopInset(of: window)
}

/// What a tab is called. The page names itself after whatever mailbox or label
/// is open, which is exactly what a tab wants to say; with nothing to go on it
/// keeps the account's name rather than showing an empty tab.
func tabTitle(pageTitle: String?, fallback: String) -> String {
    let named = (pageTitle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return named.isEmpty ? fallback : named
}

/// The tab bar's own height, and the room AppKit leaves below it inside the
/// content layout rect.
private let tabBarHeight: CGFloat = 28
let tabBarBottomPadding: CGFloat = 8

/// Where the tab bar starts and ends, worked out from what the window reports
/// its chrome covers.
func tabBarEdges(contentInset: CGFloat) -> (top: CGFloat, bottom: CGFloat)? {
    guard contentInset > 0 else { return nil }
    return (
        top: max(0, contentInset - tabBarBottomPadding - tabBarHeight),
        bottom: max(0, contentInset - tabBarBottomPadding)
    )
}

/// What the page is told, matching the rule in chrome-macos.css.
func tabInsetScript(visible: Bool, barTop: CGFloat, barBottom: CGFloat) -> String {
    guard visible else {
        return "document.body.classList.remove('fmshell-tabbed');"
            + "document.body.style.removeProperty('--fmshell-tab-inset');"
    }
    // Only a header pinned to the top of the page counts. A menu or popover
    // can carry one of its own, and measuring against that collapses the band
    // and hides the toolbar under the tab bar; when the page has headers but
    // none of them is the page's own, nothing is touched at all.
    return "(function(){"
        + "var list=document.querySelectorAll('.v-PageHeader');"
        + "var header=0,found=false;"
        + "for(var i=0;i<list.length;i++){"
        + "var r=list[i].getBoundingClientRect();"
        + "if(r.height<=0||r.top>8)continue;"
        + "if(!found||r.bottom>header){header=r.bottom;found=true;}}"
        // A page that already has a band keeps it rather than being measured
        // against a menu's header; one that has none is given a band measured
        // from the top of the page, which is too much rather than too little
        // and is corrected by the next look.
        + "if(list.length&&!found&&document.body.classList.contains('fmshell-tabbed'))return null;"
        + "var above=Math.max(0,\(Int(barTop.rounded()))-header);"
        + "var gap=Math.max(0,\(Int(barBottom.rounded()))-header+above);"
        + "document.body.classList.add('fmshell-tabbed');"
        + "document.body.style.setProperty('--fmshell-tab-inset',gap+'px');"
        + "return above;"
        + "})();"
}

@MainActor
var fullScreenObservers: [ObjectIdentifier: FullScreenObserver] = [:]

@MainActor
func observeFullScreen(_ window: NSWindow, webView: WKWebView, model: ShellModel) {
    let key = ObjectIdentifier(window)
    fullScreenObservers[key]?.tearDown()
    fullScreenObservers[key] = FullScreenObserver(window: window, webView: webView, model: model) {
        fullScreenObservers[key] = nil
    }
}

@MainActor
final class FullScreenObserver: NSObject {
    /// Joining a tab group keys no window and resizes none, so there is no
    /// notification to hang this on; the group itself has to be watched.
    private var tabGroupObservation: NSKeyValueObservation?
    private(set) weak var observedTabGroup: NSWindowTabGroup?
    private var enterToken: NSObjectProtocol?
    private var exitToken: NSObjectProtocol?
    private var closeToken: NSObjectProtocol?
    private var tintCancellable: AnyCancellable?
    private var titleCancellable: AnyCancellable?
    private weak var window: NSWindow?
    private weak var webView: WKWebView?

    init(
        window: NSWindow,
        webView: WKWebView,
        model: ShellModel,
        onClose: @escaping @MainActor @Sendable () -> Void
    ) {
        super.init()
        let center = NotificationCenter.default
        enterToken = center.addObserver(
            forName: NSWindow.didEnterFullScreenNotification, object: window, queue: .main
        ) { [weak webView] _ in
            MainActor.assumeIsolated {
                webView?.evaluateJavaScript("document.body.classList.add('fmshell-fullscreen')")
            }
        }
        exitToken = center.addObserver(
            forName: NSWindow.didExitFullScreenNotification, object: window, queue: .main
        ) { [weak webView] _ in
            MainActor.assumeIsolated {
                webView?.evaluateJavaScript("document.body.classList.remove('fmshell-fullscreen')")
            }
        }
        closeToken = center.addObserver(
            forName: NSWindow.willCloseNotification, object: window, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.tearDown()
                onClose()
            }
        }
        tintCancellable = model.$tint.sink { [weak window] tint in
            guard let tint, let window else { return }
            applyTint(tint.color, isDark: tint.isDark, to: window)
        }

        self.window = window
        self.webView = webView
        Self.watchEveryWindow()
        // The title is hidden in the title bar but it is what a tab is called,
        // so it follows the page rather than staying the account's name.
        let accountName = window.title
        titleCancellable = webView.publisher(for: \.title).sink { [weak window] title in
            MainActor.assumeIsolated {
                window?.title = tabTitle(pageTitle: title, fallback: accountName)
            }
        }

        // Itself first: it is not in the register until this returns, so a
        // sweep would pass it by.
        placeTabInset()
        Self.sweepTabInsets()
    }

    /// Follows the window from one tab group to the next.
    private func syncTabGroupObservation() {
        let group = window?.tabGroup
        guard group !== observedTabGroup else { return }
        observedTabGroup = group
        // The group reports its old answer while it is still being made, so
        // this reads the value again rather than taking the one that came with
        // the change.
        tabGroupObservation = group?.observe(\.isTabBarVisible, options: [.new]) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.placeTabInset() }
        }
    }

    /// Watches for anything happening to any window, once for the whole app.
    private static var appTokens: [NSObjectProtocol] = []

    private static func watchEveryWindow() {
        guard appTokens.isEmpty else { return }
        let center = NotificationCenter.default
        appTokens = [NSWindow.didBecomeKeyNotification, NSWindow.didResizeNotification].map {
            center.addObserver(forName: $0, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { sweepTabInsets() }
            }
        }
    }

    /// Re-measures every window there is. More than once: a group reports no
    /// visible tab bar while it is still being made, and settles a beat later,
    /// so a single look catches the state before it is true.
    static func sweepTabInsets() {
        placeEveryTabInset()
        guard !sweepScheduled else { return }
        sweepScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            MainActor.assumeIsolated { placeEveryTabInset() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            MainActor.assumeIsolated {
                placeEveryTabInset()
                sweepScheduled = false
            }
        }
    }

    private static var sweepScheduled = false

    private static func placeEveryTabInset() {
        for observer in fullScreenObservers.values { observer.placeTabInset() }
        ComposeWindows.shared.fitTabbedWindows()
    }

    /// The air a mail page leaves around the tab bar, as the page itself
    /// measured it.
    private(set) static var airAroundTabBar: CGFloat?

    fileprivate func placeTabInset() {
        syncTabGroupObservation()
        guard let window, let webView else { return }
        let edges = tabBarEdges(contentInset: tabbedPageInset(of: window))
        webView.evaluateJavaScript(tabInsetScript(
            visible: edges != nil,
            barTop: edges?.top ?? 0,
            barBottom: edges?.bottom ?? 0
        )) { value, _ in
            MainActor.assumeIsolated {
                guard let air = value as? Double else { return }
                Self.airAroundTabBar = CGFloat(air)
                ComposeWindows.shared.fitTabbedWindows()
            }
        }
    }

    var isActive: Bool {
        enterToken != nil || exitToken != nil || closeToken != nil || tintCancellable != nil
    }

    func tearDown() {
        let center = NotificationCenter.default
        [enterToken, exitToken, closeToken]
            .compactMap { $0 }.forEach(center.removeObserver)
        enterToken = nil
        exitToken = nil
        closeToken = nil
        tintCancellable?.cancel()
        tintCancellable = nil
        titleCancellable?.cancel()
        titleCancellable = nil
        tabGroupObservation?.invalidate()
        tabGroupObservation = nil
        observedTabGroup = nil
    }
}
#endif
