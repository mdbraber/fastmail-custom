#if !canImport(UIKit)
import WebKit

/// Keeps a mail window's page running while the window is in the background.
///
/// WebKit suspends the process of a page whose window is covered, minimised
/// or behind another app, waking it only now and then. Fastmail's offline
/// worker runs in that same process, and new mail reaches the page through
/// it, so a suspended page stopped taking in new mail: a request caught
/// half-way was never answered, and the page, which sends nothing more until
/// its request comes back, showed the old list for as long as the window
/// stayed in the background. Fastmail's own desktop app is never suspended
/// this way, and neither is the mail window here.
///
/// The switch is one of WebKit's own feature flags, reached through private
/// names, so each step asks first and a WebKit without it leaves the default
/// in place rather than trapping.
enum BackgroundThrottling {
    static let featureKey = "BackgroundWebContentRunningBoardThrottlingEnabled"
    private static let features = Selector(("_features"))
    private static let setEnabled = Selector(("_setEnabled:forFeature:"))

    @discardableResult
    static func keepRunning(_ preferences: WKPreferences) -> Bool {
        let type: AnyObject = WKPreferences.self
        guard
            type.responds(to: features),
            preferences.responds(to: setEnabled),
            let list = type.perform(features)?.takeUnretainedValue() as? [NSObject],
            let feature = list.first(where: { key(of: $0) == featureKey }),
            let method = class_getInstanceMethod(WKPreferences.self, setEnabled)
        else { return false }

        typealias Setter = @convention(c) (AnyObject, Selector, Bool, AnyObject) -> Void
        let set = unsafeBitCast(method_getImplementation(method), to: Setter.self)
        set(preferences, setEnabled, false, feature)
        return true
    }

    /// Not suspended is not enough: while the window is covered WebKit
    /// still runs the page at background priority, and the offline worker's
    /// sync then crawled, holding the offline copy for close to a minute
    /// while the page's own requests waited behind it. The same message came
    /// through in five seconds with the window uncovered. So the page is
    /// told nothing about the window being covered; a minimised window, or
    /// the app hidden, still counts as out of sight.
    @discardableResult
    static func ignoreCovering(_ view: WKWebView) -> Bool {
        let setter = Selector(("_setWindowOcclusionDetectionEnabled:"))
        guard view.responds(to: setter),
              let method = class_getInstanceMethod(WKWebView.self, setter) else { return false }

        typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
        let set = unsafeBitCast(method_getImplementation(method), to: Setter.self)
        set(view, setter, false)
        return true
    }

    /// Seen and running, the page was still slowed down: some 45 seconds
    /// after the app left the front WebKit calls the page visually idle and
    /// lets its process nap, at the lowest priority the system has. New
    /// mail arriving then took the offline worker 7 to 37 seconds to take
    /// in, though each of its requests to the server came back within 50
    /// milliseconds. With this off the process keeps the priority it has
    /// in front.
    @discardableResult
    static func keepPriority(_ preferences: WKPreferences) -> Bool {
        let setter = Selector(("_setPageVisibilityBasedProcessSuppressionEnabled:"))
        guard preferences.responds(to: setter),
              let method = class_getInstanceMethod(WKPreferences.self, setter) else { return false }

        typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
        let set = unsafeBitCast(method_getImplementation(method), to: Setter.self)
        set(preferences, setter, false)
        return true
    }

    private static func key(of feature: NSObject) -> String? {
        let getter = Selector(("key"))
        guard feature.responds(to: getter) else { return nil }
        return feature.perform(getter)?.takeUnretainedValue() as? String
    }
}

/// Keeps the mail page at its priority while the app is hidden or its window
/// minimised.
///
/// A page nobody can see is run at the lowest priority the system has, and
/// nothing WebKit offers changes that: with the app hidden, two new messages
/// in three raised no notification at all, and no request left the offline
/// worker for minutes. What WebKit does count is any page of the same
/// process that is in sight. So the app keeps one window that hiding leaves
/// alone, a single clear point nobody can click, holding an empty page that
/// shares the mail page's process.
@MainActor
final class BackgroundCompany {
    static let shared = BackgroundCompany()

    private(set) var window: NSWindow?

    @discardableResult
    func keep(_ mail: WKWebView) -> Bool {
        if window != nil { return true }

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = mail.configuration.websiteDataStore
        let setter = Selector(("_setRelatedWebView:"))
        guard configuration.responds(to: setter) else { return false }
        configuration.perform(setter, with: mail)
        BackgroundThrottling.keepRunning(configuration.preferences)
        BackgroundThrottling.keepPriority(configuration.preferences)

        let frame = NSRect(x: 0, y: 0, width: 1, height: 1)
        let view = WKWebView(frame: frame, configuration: configuration)
        BackgroundThrottling.ignoreCovering(view)

        let window = CompanyWindow(
            contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false
        )
        window.canHide = false
        window.isReleasedWhenClosed = false
        window.ignoresMouseEvents = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.isExcludedFromWindowsMenu = true
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.contentView = view
        window.orderBack(nil)
        self.window = window

        view.loadHTMLString("", baseURL: nil)
        return true
    }
}

/// Not a window of the user's: whoever goes through the app's windows looking
/// for one to bring forward passes this one by.
final class CompanyWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
#endif
