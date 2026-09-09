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
final class FullScreenObserver {
    private var enterToken: NSObjectProtocol?
    private var exitToken: NSObjectProtocol?
    private var closeToken: NSObjectProtocol?
    private var tintCancellable: AnyCancellable?

    init(
        window: NSWindow,
        webView: WKWebView,
        model: ShellModel,
        onClose: @escaping @MainActor @Sendable () -> Void
    ) {
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
    }

    var isActive: Bool {
        enterToken != nil || exitToken != nil || closeToken != nil || tintCancellable != nil
    }

    func tearDown() {
        let center = NotificationCenter.default
        [enterToken, exitToken, closeToken].compactMap { $0 }.forEach(center.removeObserver)
        enterToken = nil
        exitToken = nil
        closeToken = nil
        tintCancellable?.cancel()
        tintCancellable = nil
    }
}
#endif
