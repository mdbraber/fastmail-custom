import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// One entry in the menu a long press on the home screen icon opens.
public struct HomeShortcut: Equatable, Sendable {
    /// The picture drawn beside the title.
    public enum Icon: Hashable, Sendable {
        /// A name from Apple's own symbol catalog.
        case system(String)
        /// A template image in the app's asset catalog. Needed for the funnel,
        /// which Apple has no symbol for: its filter glyph is three shortening
        /// lines, and the funnel is what this label wears everywhere else it
        /// is drawn.
        case template(String)
    }

    public let type: String
    public let title: String
    public let icon: Icon
    /// The page it opens, as a path on Fastmail; nothing for an entry that
    /// only asks the page to do something.
    public let path: String?
    /// A page action to run once the app is up, for what no address reaches.
    /// Fastmail has no address for search: /mail/search:<query> opens results
    /// and an empty one bounces to the Inbox, so the page opens it itself.
    public let action: String?

    public init(type: String, title: String, icon: Icon, path: String? = nil, action: String? = nil) {
        self.type = type
        self.title = title
        self.icon = icon
        self.path = path
        self.action = action
    }
}

/// The home screen's long-press menu: the two lists worth opening straight
/// into, and the two things worth starting straight into.
public enum HomeShortcuts {
    public static let labelType = "shell.open.badgeLabel"
    public static let inboxType = "shell.open.inbox"
    public static let searchType = "shell.open.search"
    public static let composeType = "shell.open.compose"
    /// Where the path travels in a shortcut's `userInfo`.
    public static let pathKey = "path"
    /// And where a page action does.
    public static let actionKey = "action"

    static let inboxTitle = "Inbox"
    static let inboxPath = "/mail/Inbox"
    static let searchTitle = "Search"
    /// Registered by the harness, which knows which control opens search in
    /// the layout on screen.
    static let searchAction = "search"
    static let composeTitle = "Compose"
    /// The address a compose window is opened at, minus the chrome argument
    /// that only a window of its own wants.
    static let composePath = "/mail/Inbox/compose"

    /// The funnel, drawn from the same geometry the sidebar row and the switch
    /// above the list use, and carried in the apps' shared asset catalog
    /// because Apple's catalog has no funnel in it.
    public static let funnelImageName = "TriageFunnel"

    public static func shortcuts(badgeLabel: String?) -> [HomeShortcut] {
        let inbox = HomeShortcut(
            type: inboxType,
            title: inboxTitle,
            icon: .system("tray"),
            path: inboxPath
        )
        // The two that start something rather than open somewhere. They come
        // after the lists because iOS draws the menu from the icon outwards,
        // which puts the last of them under your thumb.
        let search = HomeShortcut(
            type: searchType,
            title: searchTitle,
            icon: .system("magnifyingglass"),
            action: searchAction
        )
        let compose = HomeShortcut(
            type: composeType,
            title: composeTitle,
            icon: .system("square.and.pencil"),
            path: composePath
        )
        let label = (badgeLabel ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty, label.lowercased() != inboxTitle.lowercased() else {
            return [inbox, search, compose]
        }
        // The funnel, not a tag. Everywhere else this label is drawn it wears
        // that glyph, because what it names is the mail still waiting rather
        // than a label like any other.
        let shortcut = HomeShortcut(
            type: labelType,
            title: label,
            icon: .template(funnelImageName),
            path: path(forLabel: label)
        )
        // Four, which is all iOS draws.
        return [shortcut, inbox, search, compose]
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
    /// stale entry cannot name another host.
    public static func url(path: String, backend: Backend = .standard) -> URL? {
        guard path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("://") else { return nil }
        var components = URLComponents()
        components.scheme = "https"
        components.host = backend.host
        components.percentEncodedPath = path
        return components.url
    }

    /// The badge label as the app has it: the stored value, or the default.
    public static func badgeLabel(in defaults: UserDefaults = .standard) -> String {
        defaults.string(forKey: CustomModeSettings.defaultsKey(for: "appBadgeLabel"))
            ?? CustomModeSettings.badgeLabelDefault
    }
}

extension CharacterSet {
    /// One path segment: the unreserved characters, so `/`, `?`, `#` and `&`
    /// are all encoded rather than read as structure.
    static let fastmailPathSegment = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
}

#if canImport(UIKit)
extension HomeShortcuts {
    /// A template image is looked up in the main bundle's asset catalog, which
    /// is the app's own; the shared catalog these live in is compiled into
    /// both shells, so the name resolves in either.
    static func icon(for icon: HomeShortcut.Icon) -> UIApplicationShortcutIcon {
        switch icon {
        case .system(let name):
            return UIApplicationShortcutIcon(systemImageName: name)
        case .template(let name):
            return UIApplicationShortcutIcon(templateImageName: name)
        }
    }

    /// Rebuilds the menu from the current settings. Cheap and idempotent.
    @MainActor
    public static func refresh(defaults: UserDefaults = .standard) {
        UIApplication.shared.shortcutItems = shortcuts(badgeLabel: badgeLabel(in: defaults)).map { shortcut in
            var info: [String: NSSecureCoding] = [:]
            if let path = shortcut.path { info[pathKey] = path as NSString }
            if let action = shortcut.action { info[actionKey] = action as NSString }
            return UIApplicationShortcutItem(
                type: shortcut.type,
                localizedTitle: shortcut.title,
                localizedSubtitle: nil,
                icon: icon(for: shortcut.icon),
                userInfo: info
            )
        }
    }

    /// Hands the chosen entry to the shell, which loads it in the web view
    /// the same way a tapped push is loaded. Answers whether it was ours.
    @MainActor
    @discardableResult
    public static func open(_ item: UIApplicationShortcutItem) -> Bool {
        var handled = false

        if let path = item.userInfo?[pathKey] as? String, let url = url(path: path) {
            PendingLinks.shared.open(url)
            handled = true
        }
        // An entry can carry both: go here, then do this. Nothing does yet,
        // but the two travel separately because search wants no address and
        // the lists want nothing done.
        if let action = item.userInfo?[actionKey] as? String, !action.isEmpty {
            PendingActions.shared.run(action)
            handled = true
        }

        return handled
    }
}
#endif
