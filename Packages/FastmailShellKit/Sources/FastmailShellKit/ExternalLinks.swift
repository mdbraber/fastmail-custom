import Foundation

#if canImport(UIKit)
import SafariServices
import UIKit
#endif

public enum ExternalLinkDestination: Equatable, Sendable {
    /// An `SFSafariViewController` over the app, with its own Done button.
    case inAppBrowser
    /// Whatever the system does with the link: Safari, or the app that claims it.
    case system
}

/// Where a link the navigation policy sends out of the app goes on iPhone and
/// iPad. Only a web address with a host can be shown in the in-app browser;
/// mailto, tel, facetime, webcal and every other scheme still go to the
/// system. A link to the other account's app never comes through here: it is
/// handed over in AppShell, as it always was.
public enum ExternalLinks {
    public static func destination(for url: URL, inAppBrowser: Bool) -> ExternalLinkDestination {
        guard
            inAppBrowser,
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            let host = url.host,
            !host.isEmpty
        else { return .system }
        return .inAppBrowser
    }
}

#if canImport(UIKit)
extension ExternalLinks {
    /// Opens the link where the Use in-app browser switch says.
    @MainActor
    public static func open(_ url: URL, defaults: UserDefaults = .standard) {
        switch destination(for: url, inAppBrowser: DevicePreferences.inAppBrowser(in: defaults)) {
        case .inAppBrowser:
            // Presented from the app's window, so while the lock is up it
            // waits beneath the cover. A controller still coming or going
            // cannot present, and the system takes the link instead.
            guard
                let presenter = AppWindow.topViewController(),
                !presenter.isBeingPresented,
                !presenter.isBeingDismissed
            else {
                UIApplication.shared.open(url)
                return
            }
            presenter.present(SFSafariViewController(url: url), animated: true)
        case .system:
            UIApplication.shared.open(url)
        }
    }
}
#endif
