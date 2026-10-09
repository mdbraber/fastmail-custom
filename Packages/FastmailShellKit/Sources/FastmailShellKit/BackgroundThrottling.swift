#if !canImport(UIKit)
import AppKit
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
/// What the app does when the windows run out, and the links that come from
/// outside the app.
///
/// New mail reaches the shell through the mail page, and a page with no window
/// to run in is put to sleep whatever the preferences say. The app answered
/// that with windows nobody could see: a 1×1 clear one holding a page sharing
/// the mail page's process, and, after Command-W, the mail window itself kept
/// ordered out of sight with its page in it. Banners kept coming, and the
/// system's window bookkeeping stopped being the truth about where this app's UI
/// is. It counts both of them as windows in sight, yet neither can become key,
/// so activating the app — Command-Tab, a click in the Dock — found nothing to
/// bring forward. That is the likeliest cause of the switcher appearing to do
/// nothing, and of a Dock click sending the app backwards instead of out.
///
/// Decided 2026-10-05: mail keeps arriving while the app runs, which the
/// throttling switches above do without inventing a window, and the app ends
/// with its last window, as every other app does. Reopening is AppKit's
/// business again, so what is left here is only what an app delegate alone can
/// hear.
public final class DockClick: NSObject, NSApplicationDelegate {
    public override init() {
        super.init()
        // The delegate both Mac apps install, and the earliest place there is
        // to hear activation from
        FocusProbe.installFromOutsideMainActor()
    }

    /// A link from outside: a mailto, or one in the app's own scheme. The
    /// window group is told to take none of them, because on macOS 27 it
    /// answers each with a new mail window that is never shown and hands the
    /// link to no window at all. So they come here, and go on to the shell
    /// the way a clicked notification does.
    public func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { PendingLinks.shared.open(url) }
    }

    /// Closing the last window quits the app, and new mail stops with it.
    public func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        let stays = Self.staysOpen(sender.windows)
        FocusProbe.note("window closed; \(stays ? "another window still open" : "the last one, quitting")")
        return !stays
    }

    /// Whether anything of the user's is left to keep the app up: a window in
    /// sight or in the Dock. A message being written and a message popped out
    /// count, and so does a file picker while it is open — being in sight is
    /// what makes it the user's, and what makes it count is the same thing.
    /// The compose pool's spare waits ordered out, so it does not.
    ///
    /// Do not add `is NSPanel` here to let pickers count: AppKit asks this
    /// question once the closing window has gone, and AppKit's own windows are
    /// in the list too — a tooltip, seen while this was first written, is an
    /// `NSToolTipPanel` sitting at level 103 with `vis=0`, and counting panels
    /// by class meant a hover over the toolbar kept the app up forever.
    static func staysOpen(_ windows: [NSWindow]) -> Bool {
        windows.contains { $0.isVisible || $0.isMiniaturized }
    }
}
#endif
