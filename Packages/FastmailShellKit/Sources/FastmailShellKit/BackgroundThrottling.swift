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

    private static func key(of feature: NSObject) -> String? {
        let getter = Selector(("key"))
        guard feature.responds(to: getter) else { return nil }
        return feature.perform(getter)?.takeUnretainedValue() as? String
    }
}
#endif
