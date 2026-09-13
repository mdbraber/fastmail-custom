import Foundation

/// The Device settings page's own settings on iPhone and iPad, kept in the
/// app's standard defaults, so Personal and Work each have their own.
public enum DevicePreferences {
    public static let screenLockKey = "device.screenLock"
    public static let rememberPageKey = "device.rememberPage"
    /// A path with its query and fragment, starting with `/`; never a host.
    public static let lastPageKey = "device.lastPage"
    public static let inAppBrowserKey = "device.inAppBrowser"
    public static let remoteDebuggingKey = "device.remoteDebugging"

    public static func screenLock(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: screenLockKey) as? Bool ?? false
    }

    public static func rememberPage(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: rememberPageKey) as? Bool ?? false
    }

    /// The saved page, or nothing when none is saved or what is stored is not a
    /// path of this app's own.
    public static func lastPage(in defaults: UserDefaults = .standard) -> String? {
        guard
            let path = defaults.string(forKey: lastPageKey),
            path.hasPrefix("/"),
            !path.hasPrefix("//")
        else { return nil }
        return path
    }

    public static func inAppBrowser(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: inAppBrowserKey) as? Bool ?? true
    }

    public static func remoteDebugging(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: remoteDebuggingKey) as? Bool ?? true
    }

    /// Turning Remember last viewed page off forgets the page it had saved.
    public static func setRememberPage(_ on: Bool, in defaults: UserDefaults = .standard) {
        defaults.set(on, forKey: rememberPageKey)
        if !on { defaults.removeObject(forKey: lastPageKey) }
    }

    /// The first path segments of Fastmail's own views. Anything else, the
    /// login page among it, is not a page to come back to.
    static let rememberedViews: Set<String> = ["mail", "calendar", "contacts", "notes", "files", "settings"]

    /// What is worth saving of an address the main web view shows: its path,
    /// query and fragment, as they are encoded. Nothing for another host, a
    /// scheme other than https, a page outside Fastmail's views such as the
    /// login page, or a message being written, which would open an empty
    /// draft at every launch.
    public static func rememberablePath(of url: URL?) -> String? {
        guard
            let url,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == "https",
            LinkRouter.isFastmailHost(components.host)
        else { return nil }
        let path = components.percentEncodedPath
        let segments = path.split(separator: "/").map(String.init)
        guard
            let view = segments.first?.lowercased(),
            rememberedViews.contains(view),
            !segments.contains("compose")
        else { return nil }
        var remembered = path
        if let query = components.percentEncodedQuery, !query.isEmpty { remembered += "?" + query }
        if let fragment = components.percentEncodedFragment, !fragment.isEmpty { remembered += "#" + fragment }
        return remembered
    }

    /// Saves the page the main web view shows, while the switch is on. An
    /// address that is not worth saving leaves the last good one in place.
    public static func recordPage(_ url: URL?, in defaults: UserDefaults = .standard) {
        guard rememberPage(in: defaults), let path = rememberablePath(of: url) else { return }
        guard defaults.string(forKey: lastPageKey) != path else { return }
        defaults.set(path, forKey: lastPageKey)
    }
}

extension Profile {
    /// The address the iPhone and iPad apps open at launch: the saved page
    /// while Remember last viewed page is on and a page is saved, otherwise
    /// the Start page, otherwise Fastmail's default view; always on the
    /// current backend, so switching backends keeps the page.
    ///
    /// A link the app was launched with is not part of this. It is routed once
    /// the app is up, as it always was, and replaces whatever this loaded.
    public func launchURL(readingFrom defaults: UserDefaults) -> URL {
        if DevicePreferences.rememberPage(in: defaults), let saved = DevicePreferences.lastPage(in: defaults) {
            return StartView.resolve(saved, default: startURL, backend: Backend.current(defaults))
        }
        return startURL(readingFrom: defaults)
    }
}
