#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import SwiftUI
import WebKit
import Combine

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
///
/// Fastmail's own app draws a 52-point header and puts its buttons in the
/// middle of it. A plain title bar is 32 points, so ours sat nine points above
/// and ten points to the left of the icons alongside them, which is what the
/// gap looked like. A unified toolbar gives the title bar the height that
/// centres them in the header, and AppKit keeps them there through resizes and
/// full screen — where setting the frames by hand does not, because it lays
/// them out again each time.
///
/// The toolbar carries nothing and is never seen: with a transparent title bar
/// over full-size content it draws nothing, the page still receives clicks at
/// every depth, and the web view keeps the whole window. It has to stay
/// visible, though — hiding it puts the buttons back.
@MainActor
private func raiseTitlebar(of window: NSWindow) {
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
    // be asked. With no answer the appearance is left alone, so a navy log-in
    // screen no longer takes the whole app dark with it.
    if let isDark {
        window.appearance = NSAppearance(named: isDark ? .darkAqua : .aqua)
    }
    window.backgroundColor = NSColor(
        srgbRed: rgb.0, green: rgb.1, blue: rgb.2, alpha: 1
    )
    window.contentView?.superview?.needsDisplay = true
    window.invalidateShadow()
}

/// How far the window's chrome reaches down over the content: the title bar
/// and its toolbar, plus the tab bar when there is one.
@MainActor
func contentTopInset(of window: NSWindow) -> CGFloat {
    guard let content = window.contentView else { return 0 }
    return max(0, content.bounds.height - window.contentLayoutRect.maxY)
}

/// How far down the page has to start.
///
/// Normally nothing: the header is meant to show through the transparent
/// title bar, with the window buttons set into it. A tab bar is different —
/// AppKit draws it over the page rather than moving the page down — so it
/// covers a strip of the list and leaves a sliver of page showing above
/// itself. Measured from the window rather than assumed, so it is right
/// whatever height the bar turns out to be.
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
/// content layout rect. Neither is exposed — the bar is not among the window's
/// views to ask — so both were measured against its frame: a bar running from
/// 66 to 94 while the window reported its content beginning at 102.
private let tabBarHeight: CGFloat = 28
private let tabBarBottomPadding: CGFloat = 8

/// Where the tab bar starts and ends, worked out from what the window reports
/// its chrome covers. Nothing here depends on what a particular window has
/// been through, so every tab in a group arrives at the same answer — reading
/// the top edge off a spell with no tab bar meant a window born into a group
/// had never seen one, and its page lost the air its neighbours had.
func tabBarEdges(contentInset: CGFloat) -> (top: CGFloat, bottom: CGFloat)? {
    guard contentInset > 0 else { return nil }
    return (
        top: max(0, contentInset - tabBarBottomPadding - tabBarHeight),
        bottom: max(0, contentInset - tabBarBottomPadding)
    )
}

/// What the page is told, matching the rule in chrome-macos.css.
///
/// The header stays where it is, with the window buttons in it: only what sits
/// below the header moves down, far enough to clear the tab bar. The band left
/// between the two is painted in the window's background colour, which is
/// sampled from the header itself, so it reads as one taller header with the
/// tabs directly beneath the search bar.
///
/// The bar is then given half as much air below it as it has above: the room
/// above is macOS's to decide, since it puts the bar a fixed distance down and
/// Fastmail centres the search box in its header, so only the room below is
/// ours to set. Both edges are measured in the page rather than assumed here,
/// so they stay right whatever Fastmail makes them.
func tabInsetScript(visible: Bool, barTop: CGFloat, barBottom: CGFloat) -> String {
    guard visible else {
        return "document.body.classList.remove('fmshell-tabbed');"
            + "document.body.style.removeProperty('--fmshell-tab-inset');"
    }
    return "(function(){"
        + "var h=document.querySelector('.v-PageHeader');"
        + "var header=h?h.getBoundingClientRect().bottom:0;"
        + "var s=document.querySelector('.v-PageHeader input,.v-PageHeader .v-TextInput');"
        + "var searchBottom=s?s.getBoundingClientRect().bottom:header;"
        + "var above=Math.max(0,\(Int(barTop.rounded()))-searchBottom);"
        + "var gap=Math.max(0,\(Int(barBottom.rounded()))-header+Math.round(above/2));"
        + "document.body.classList.add('fmshell-tabbed');"
        + "document.body.style.setProperty('--fmshell-tab-inset',gap+'px');"
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
    ///
    /// The group is watched directly rather than through the window's
    /// `tabGroup`. A window swaps groups without announcing it, so an
    /// observation registered through that property ends up trying to
    /// unregister from a group that never carried it, and Foundation raises
    /// rather than shrugging — which closing a tab would then do every time.
    private var tabGroupObservation: NSKeyValueObservation?
    private(set) weak var observedTabGroup: NSWindowTabGroup?
    private var enterToken: NSObjectProtocol?
    private var exitToken: NSObjectProtocol?
    private var closeToken: NSObjectProtocol?
    private var tabToken: NSObjectProtocol?
    private var resizeToken: NSObjectProtocol?
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
        // Merging into a tab group, and leaving one, both key and resize the
        // window; there is no notification for the tab bar itself.
        tabToken = center.addObserver(
            forName: NSWindow.didBecomeKeyNotification, object: window, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyTabInset() }
        }
        resizeToken = center.addObserver(
            forName: NSWindow.didResizeNotification, object: window, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.applyTabInset() }
        }
        // The title is hidden in the title bar but it is what a tab is called,
        // so it follows the page rather than staying the account's name.
        let accountName = window.title
        titleCancellable = webView.publisher(for: \.title).sink { [weak window] title in
            MainActor.assumeIsolated {
                window?.title = tabTitle(pageTitle: title, fallback: accountName)
            }
        }

        applyTabInset()
    }

    /// Follows the window from one tab group to the next. Which group a window
    /// belongs to is only ever read here, never observed, so this is called
    /// again each time the inset is placed.
    private func syncTabGroupObservation() {
        let group = window?.tabGroup
        guard group !== observedTabGroup else { return }
        observedTabGroup = group
        // The group reports its old answer while it is still being made, so
        // this reads the value again rather than taking the one that came
        // with the change.
        tabGroupObservation = group?.observe(\.isTabBarVisible, options: [.new]) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.applyTabInset() }
        }
    }

    /// More than once: a group reports no visible tab bar while it is still
    /// being made, and settles a beat later, so a single look catches the
    /// state before it is true.
    private func applyTabInset() {
        placeTabInset()
        for delay in [0.3, 1.2] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                MainActor.assumeIsolated { self?.placeTabInset() }
            }
        }
    }

    private func placeTabInset() {
        syncTabGroupObservation()
        guard let window, let webView else { return }
        let edges = tabBarEdges(contentInset: tabbedPageInset(of: window))
        webView.evaluateJavaScript(tabInsetScript(
            visible: edges != nil,
            barTop: edges?.top ?? 0,
            barBottom: edges?.bottom ?? 0
        ))
    }

    var isActive: Bool {
        enterToken != nil || exitToken != nil || closeToken != nil || tintCancellable != nil
    }

    func tearDown() {
        let center = NotificationCenter.default
        [enterToken, exitToken, closeToken, tabToken, resizeToken]
            .compactMap { $0 }.forEach(center.removeObserver)
        enterToken = nil
        exitToken = nil
        closeToken = nil
        tabToken = nil
        resizeToken = nil
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
