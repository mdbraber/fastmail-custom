#if !canImport(UIKit)
import WebKit

/// The Web Inspector, opened from the menu bar.
///
/// WebKit offers no public way to open it. A web view marked `isInspectable`
/// puts Inspect Element into the menu WebKit draws for a right-click, and that
/// is the whole of the public story; Fastmail answers contextmenu on the
/// document and cancels it, so in these apps that menu never appears on its
/// own. Fastmail Custom lets a Shift-held right-click through for exactly that
/// reason, and this is the same door reached from the keyboard, for the times
/// the page is too broken to be running its own script.
///
/// What it reaches for is private, so nothing here forces anything: each step
/// asks whether the object answers to the name before using it, and a WebKit
/// that has moved the inspector leaves the menu item saying so rather than
/// trapping. `value(forKey:)` is deliberately not the way in, because a key
/// WebKit no longer has raises an Objective-C exception that Swift cannot
/// catch.
enum WebInspector {
    private static let inspector = Selector(("_inspector"))
    private static let show = Selector(("show"))

    static func open(for webView: WKWebView) -> Bool {
        guard webView.isInspectable, webView.responds(to: inspector) else { return false }
        guard
            let panel = webView.perform(inspector)?.takeUnretainedValue() as? NSObject,
            panel.responds(to: show)
        else { return false }

        panel.perform(show)
        return true
    }
}
#endif
