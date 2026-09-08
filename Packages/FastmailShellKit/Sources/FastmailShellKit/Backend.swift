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

    /// The server a profile talks to when nothing has been chosen. Both
    /// shells run against beta, so an unset backend means beta and not
    /// production. Everything that needs a default reads this one, so the
    /// picker's initial selection, the iOS Settings row, the value an
    /// unreadable name falls back to and the convenience defaults on the
    /// address builders cannot drift apart.
    public static let standard: Backend = .beta

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

    /// Anything unrecognised is the standard backend. The value arrives as a
    /// bare string from the iOS Settings app, so it can be an older build's
    /// spelling or something hand-edited, and the safe reading of a name we do
    /// not know is the usual server rather than none at all.
    public static func resolve(_ raw: String?) -> Backend {
        let trimmed = (raw ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return Backend(rawValue: trimmed) ?? standard
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

    /// The address as it should leave the app. Both shells run against beta,
    /// so the page's own address names a server that is nobody else's and
    /// opens nowhere else; a link handed to Shortcuts, a share sheet or the
    /// clipboard names the production host instead. Coming back the other way
    /// the shell rehosts, which is how a home screen shortcut and a tapped
    /// notification already work.
    ///
    /// Only Fastmail's own hosts move. Anything else is somebody else's
    /// address, and rewriting it would point it somewhere it never named.
    public static func canonical(_ url: URL) -> URL {
        guard let host = url.host?.lowercased(), knownHosts.contains(host) else { return url }
        return production.rehost(url)
    }
}
