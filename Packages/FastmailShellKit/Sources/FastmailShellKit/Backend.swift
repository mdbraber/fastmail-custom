import Foundation

/// Which Fastmail server the app talks to. Fastmail's own app offers the same
/// choice under Settings → Device settings → Show Advanced Settings, and this
/// is the shell's version of it.
///
/// The two are separate origins, so they are separate cookie jars and separate
/// local storage: switching means signing in again on that side, and the page
/// starts out with none of what it had learned on the other. That is the cost
/// of the setting, not a fault in it.
public enum Backend: String, CaseIterable, Sendable {
    case production
    case beta

    public static let defaultsKey = "backend"

    public var host: String {
        switch self {
        case .production: "app.fastmail.com"
        case .beta: "app.beta.fastmail.com"
        }
    }

    public var title: String {
        switch self {
        case .production: "Production"
        case .beta: "Beta"
        }
    }

    public var baseURL: URL {
        URL(string: "https://\(host)/")!
    }

    /// Every host the shell knows, whichever one is selected. An incoming link
    /// to the other server is still a Fastmail link, and refusing it would be
    /// a worse answer than opening it.
    public static let knownHosts = allCases.map(\.host)

    /// Anything unrecognised is production. The value arrives as a bare string
    /// from the iOS Settings app, so it can be an older build's spelling or
    /// something hand-edited, and the safe reading of a name we do not know is
    /// the ordinary server rather than none at all.
    public static func resolve(_ raw: String?) -> Backend {
        let trimmed = (raw ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return Backend(rawValue: trimmed) ?? .production
    }

    public static func current(_ defaults: UserDefaults = .standard) -> Backend {
        resolve(defaults.string(forKey: defaultsKey))
    }

    /// The same address on this server. Both halves of the start URL go
    /// through here — the profile's own default and whatever is typed into the
    /// setting — so the backend decides the host and the start URL is left to
    /// say only which view to open.
    public func rehost(_ url: URL) -> URL {
        guard
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.host != nil
        else { return url }
        components.host = host
        return components.url ?? url
    }
}
