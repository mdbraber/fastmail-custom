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
        if let window {
            if !window.isVisible { window.orderBack(nil) }
            return true
        }

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

/// A click on the app in the Dock, with the mail window minimised or closed.
///
/// The system brings a window back only when it finds none in sight, and it
/// counts the company window as one, so the click did nothing. The app
/// looks again, leaving that window out: a minimised window is brought
/// back, a closed one shown again. It also receives the links that come from
/// outside the app.
public final class DockClick: NSObject, NSApplicationDelegate {
    /// A link from outside: a mailto, or one in the app's own scheme. The
    /// window group is told to take none of them, because on macOS 27 it
    /// answers each with a new mail window that is never shown and hands the
    /// link to no window at all. So they come here, and go on to the shell
    /// the way a clicked notification does.
    public func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { PendingLinks.shared.open(url) }
    }

    enum Answer: Equatable {
        case asUsual
        case bringBack
        case showAgain
        case askAgainWithoutCompany
    }

    static func answer(othersInSight: Bool, minimised: Bool, closed: Bool) -> Answer {
        if othersInSight { return .asUsual }
        if minimised { return .bringBack }
        return closed ? .showAgain : .askAgainWithoutCompany
    }

    public func applicationShouldHandleReopen(
        _ sender: NSApplication, hasVisibleWindows flag: Bool
    ) -> Bool {
        let company = BackgroundCompany.shared.window
        let others = sender.windows.filter { !($0 is CompanyWindow) }
        let minimised = others.first { $0.isMiniaturized }
        // A closed mail window is kept, page and all, which is what lets
        // new mail still raise a notification
        let closed = WebViewRegistry.shared.views.compactMap(\.window).first
        switch Self.answer(
            othersInSight: others.contains { $0.isVisible },
            minimised: minimised != nil,
            closed: closed != nil
        ) {
        case .asUsual:
            return true
        case .bringBack:
            minimised?.deminiaturize(nil)
            return false
        case .showAgain:
            closed?.makeKeyAndOrderFront(nil)
            return false
        case .askAgainWithoutCompany:
            guard flag, let company, company.isVisible else { return true }
            // With nothing in sight the system opens a window itself, and
            // the mail page in it puts the company window back.
            company.orderOut(nil)
            _ = try? NSAppleEventDescriptor(
                eventClass: AEEventClass(kCoreEventClass),
                eventID: AEEventID(kAEReopenApplication),
                targetDescriptor: .currentProcess(),
                returnID: AEReturnID(kAutoGenerateReturnID),
                transactionID: AETransactionID(kAnyTransactionID)
            ).sendEvent(options: .noReply, timeout: 1)
            return false
        }
    }
}

/// Closing the last mail window puts it out of sight and keeps its page.
///
/// The page is what hears of new mail and raises the notification, and a
/// closed window took it along: nothing was heard until a window was opened
/// again. So the window is kept, as a mail app's is, and a click in the Dock
/// or on a notification shows it again as it was left. With another mail
/// window open, or in full screen, closing is closing.
///
/// The window has a delegate of its own already, SwiftUI's. This one stands
/// in front of it, answers the one question and passes everything else on.
final class ClosedWindowKeeper: NSObject, NSWindowDelegate {
    private weak var theirs: NSWindowDelegate?
    private let otherMailWindowsOpen: @MainActor () -> Int
    nonisolated(unsafe) private static var key = 0

    static func keeps(otherMailWindowsOpen: Int, fullScreen: Bool) -> Bool {
        otherMailWindowsOpen == 0 && !fullScreen
    }

    /// The mail window closing put out of sight, if there is one
    @MainActor
    static func kept(among windows: [NSWindow]) -> NSWindow? {
        windows.first { !$0.isVisible && !$0.isMiniaturized }
    }

    /// Shows the kept window in place of a new one, which would have been a
    /// second page taking in the same mail.
    @MainActor
    static func showKept() -> Bool {
        let windows = WebViewRegistry.shared.views.compactMap(\.window)
        guard let kept = kept(among: windows) else { return false }
        NSApp.unhide(nil)
        kept.makeKeyAndOrderFront(nil)
        return true
    }

    @MainActor
    static func watch(_ window: NSWindow, otherMailWindowsOpen: @escaping @MainActor () -> Int) {
        guard !(window.delegate is ClosedWindowKeeper) else { return }
        let keeper = ClosedWindowKeeper(
            theirs: window.delegate, otherMailWindowsOpen: otherMailWindowsOpen
        )
        // The window holds its delegate weakly
        objc_setAssociatedObject(window, &key, keeper, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        window.delegate = keeper
    }

    private init(theirs: NSWindowDelegate?, otherMailWindowsOpen: @escaping @MainActor () -> Int) {
        self.theirs = theirs
        self.otherMailWindowsOpen = otherMailWindowsOpen
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        MainActor.assumeIsolated {
            guard Self.keeps(
                otherMailWindowsOpen: otherMailWindowsOpen(),
                fullScreen: sender.styleMask.contains(.fullScreen)
            ) else {
                return theirs?.windowShouldClose?(sender) ?? true
            }
            // Messages being written in its tabs stay where they are
            sender.tabGroup?.removeWindow(sender)
            sender.orderOut(nil)
            return false
        }
    }

    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || (theirs?.responds(to: selector) ?? false)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        theirs
    }
}
#endif
