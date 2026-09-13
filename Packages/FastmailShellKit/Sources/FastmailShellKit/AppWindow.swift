#if canImport(UIKit)
import UIKit

/// The app's own window on iPhone and iPad, for presenting a controller of its
/// own: a preview, the in-app browser.
///
/// Never the key window: while the screen lock is up that is the lock's cover,
/// and whatever lands on it shows above the lock and is lost when the cover
/// goes. Presented from the app's window instead, it waits beneath the cover
/// and shows once the lock has opened.
@MainActor
enum AppWindow {
    /// The controller on top of the app's window, where the next presentation
    /// goes: the active web view's window, else a window of a connected scene
    /// at the normal level, which the cover never is.
    static func topViewController() -> UIViewController? {
        let window = WebViewRegistry.shared.active?.window ?? normalLevelWindow()
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    private static func normalLevelWindow() -> UIWindow? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.windowLevel == .normal }
    }
}
#endif
