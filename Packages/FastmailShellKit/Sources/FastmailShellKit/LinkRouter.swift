import Foundation

public enum LinkRouter {
    public enum Route: Equatable, Sendable {
        case load(URL)
        case handoff(URL)
        case refuse(String)
    }

    static let composeBase = "https://app.fastmail.com/mail/compose"

    public static func route(_ url: URL, profile: Profile) -> Route {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let scheme = components.scheme?.lowercased()
        else {
            return .refuse("That link could not be read.")
        }
        if scheme == profile.urlScheme.lowercased() {
            return routeCommand(components, profile: profile)
        }
        if scheme == "mailto" {
            return .load(composeURL(mailto: url.absoluteString, accountID: profile.accountID))
        }
        if scheme == "https" {
            return routeWebLink(url, profile: profile, arrivedViaHandoff: false)
        }
        return .refuse("Links of type \(scheme): can't open here.")
    }

    private static func routeCommand(_ components: URLComponents, profile: Profile) -> Route {
        let command = (components.host ?? "").lowercased()
        let items = components.queryItems ?? []
        switch command {
        case "open":
            guard
                let raw = items.first(where: { $0.name == "url" })?.value,
                let target = URL(string: raw)
            else {
                return .refuse("The link had no destination.")
            }
            let viaHandoff = items.contains { $0.name == "handoff" && $0.value == "1" }
            return routeWebLink(target, profile: profile, arrivedViaHandoff: viaHandoff)
        case "compose":
            guard
                let raw = items.first(where: { $0.name == "mailto" })?.value,
                raw.lowercased().hasPrefix("mailto:")
            else {
                return .refuse("The link had no message to compose.")
            }
            return .load(composeURL(mailto: raw, accountID: profile.accountID))
        default:
            return .refuse("Unknown link command “\(command)”.")
        }
    }

    private static func routeWebLink(_ url: URL, profile: Profile, arrivedViaHandoff: Bool) -> Route {
        guard
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == "https",
            isFastmailHost(components.host)
        else {
            return .refuse("Only app.fastmail.com links can be opened.")
        }
        let items = components.queryItems ?? []
        let localOnly = arrivedViaHandoff || items.contains { $0.name == "handoff" && $0.value == "1" }
        let kept = items.filter { $0.name != "handoff" }
        components.queryItems = kept.isEmpty ? nil : kept
        let cleaned = components.url ?? url

        if localOnly { return .load(cleaned) }
        guard
            let accountID = profile.accountID,
            let u = items.first(where: { $0.name == "u" })?.value,
            u.caseInsensitiveCompare(accountID) != .orderedSame
        else {
            return .load(cleaned)
        }
        guard
            let handoffScheme = profile.handoffScheme,
            let handoff = handoffURL(scheme: handoffScheme, target: cleaned)
        else {
            return .load(cleaned)
        }
        return .handoff(handoff)
    }

    static func composeURL(mailto: String, accountID: String?) -> URL {
        var query = "mailto=" + percentEncode(mailto)
        if let accountID {
            query += "&u=" + percentEncode(accountID)
        }
        return URL(string: composeBase + "?" + query) ?? URL(string: composeBase)!
    }

    static func handoffURL(scheme: String, target: URL) -> URL? {
        URL(string: "\(scheme)://open?url=\(percentEncode(target.absoluteString))&handoff=1")
    }

    public static func handoffTarget(_ url: URL) -> URL? {
        guard
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            (components.host ?? "").lowercased() == "open",
            let raw = (components.queryItems ?? []).first(where: { $0.name == "url" })?.value
        else {
            return nil
        }
        return URL(string: raw)
    }

    static func percentEncode(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }

    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    )

    static func isFastmailHost(_ host: String?) -> Bool {
        guard var host = host?.lowercased() else { return false }
        if host.hasSuffix(".") {
            host.removeLast()
        }
        return host == "app.fastmail.com"
    }
}
