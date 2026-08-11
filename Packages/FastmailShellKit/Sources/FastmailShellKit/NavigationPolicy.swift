import Foundation

public enum NavigationDecision: Equatable, Sendable {
    case allow
    case openExternally
    case download
}

public enum NavigationPolicy {
    public static let allowedHosts = ["fastmail.com", "fastmailusercontent.com"]

    public static func decide(url: URL) -> NavigationDecision {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
            return .openExternally
        }
        return isAllowed(host: url.host) ? .allow : .openExternally
    }

    public static func decideResponse(canShowMIMEType: Bool, contentDisposition: String?) -> NavigationDecision {
        let disposition = contentDisposition?.lowercased() ?? ""
        if disposition.hasPrefix("attachment") { return .download }
        return canShowMIMEType ? .allow : .download
    }

    static func isAllowed(host: String?) -> Bool {
        guard let host = host?.lowercased() else { return false }
        return allowedHosts.contains { host == $0 || host.hasSuffix("." + $0) }
    }
}
