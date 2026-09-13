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
            guard let presenter = topViewController() else {
                UIApplication.shared.open(url)
                return
            }
            presenter.present(SFSafariViewController(url: url), animated: true)
        case .system:
            UIApplication.shared.open(url)
        }
    }

    @MainActor
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first { $0.isKeyWindow }
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
#endif
