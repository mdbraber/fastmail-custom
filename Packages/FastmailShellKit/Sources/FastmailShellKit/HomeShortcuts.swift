import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// One entry in the menu a long press on the home screen icon opens.
public struct HomeShortcut: Equatable, Sendable {
    public let type: String
    public let title: String
    public let systemImage: String
    /// The page it opens, as a path on Fastmail.
    public let path: String
}

/// The home screen's long-press menu: the badge label's own view and the
/// Inbox, the two lists worth opening straight into. The badge label is a
/// setting, so the menu is rebuilt whenever it changes.
public enum HomeShortcuts {
    public static let labelType = "shell.open.badgeLabel"
    public static let inboxType = "shell.open.inbox"
    /// Where the path travels in a shortcut's `userInfo`.
    public static let pathKey = "path"

    static let inboxTitle = "Inbox"
    static let inboxPath = "/mail/Inbox"

    public static func shortcuts(badgeLabel: String?) -> [HomeShortcut] {
        let inbox = HomeShortcut(type: inboxType, title: inboxTitle, systemImage: "tray", path: inboxPath)
        let label = (badgeLabel ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty, label.lowercased() != inboxTitle.lowercased() else { return [inbox] }
        let shortcut = HomeShortcut(type: labelType, title: label, systemImage: "tag", path: path(forLabel: label))
        return [shortcut, inbox]
    }

    /// A label's own view. Nested labels keep their separators; everything
    /// else in a segment is encoded, so a space or an ampersand still opens.
    static func path(forLabel label: String) -> String {
        let segments = label.split(separator: "/", omittingEmptySubsequences: true).map { segment in
            String(segment).addingPercentEncoding(withAllowedCharacters: .fastmailPathSegment) ?? String(segment)
        }
        return "/mail/" + segments.joined(separator: "/")
    }

    /// The address a shortcut opens. A shortcut carries a path and nothing
    /// else: anything that is not one is refused rather than opened, so a
    /// stale entry cannot name another host. The production host is used;
    /// the shell rehosts to the selected backend as it does for a push.
    public static func url(path: String, backend: Backend = .production) -> URL? {
        guard path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("://") else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = backend.host
        components.percentEncodedPath = path
        return components.url
    }

    /// The badge label as the app has it: the stored value, or the catalog's.
    public static func badgeLabel(in defaults: UserDefaults = .standard) -> String {
        guard let option = InboxModeSettings.options.first(where: { $0.key == "appBadgeLabel" }) else { return "" }
        if let stored = defaults.string(forKey: option.defaultsKey) { return stored }
        if case .text(let fallback) = option.defaultValue { return fallback }
        return ""
    }
}

extension CharacterSet {
    /// One path segment: the unreserved characters, so `/`, `?`, `#` and `&`
    /// are all encoded rather than read as structure.
    static let fastmailPathSegment = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
}

#if canImport(UIKit)
extension HomeShortcuts {
    /// Rebuilds the menu from the current settings. Cheap and idempotent.
    @MainActor
    public static func refresh(defaults: UserDefaults = .standard) {
        UIApplication.shared.shortcutItems = shortcuts(badgeLabel: badgeLabel(in: defaults)).map { shortcut in
            UIApplicationShortcutItem(
                type: shortcut.type,
                localizedTitle: shortcut.title,
                localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(systemImageName: shortcut.systemImage),
                userInfo: [pathKey: shortcut.path as NSString]
            )
        }
    }

    /// Hands the chosen entry to the shell, which loads it in the web view
    /// the same way a tapped push is loaded. Answers whether it was ours.
    @MainActor
    @discardableResult
    public static func open(_ item: UIApplicationShortcutItem) -> Bool {
        guard let path = item.userInfo?[pathKey] as? String, let url = url(path: path) else { return false }
        PendingLinks.shared.open(url)
        return true
    }
}
#endif
