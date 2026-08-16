import Foundation

public enum NavigationDecision: Equatable, Sendable {
    case allow
    case openExternally
    case download
    case refuse
}

public enum NavigationPolicy {
    public static let allowedHosts = ["fastmail.com", "fastmailusercontent.com"]
    public static let allowedSchemes: Set<String> = ["http", "https", "mailto", "tel", "facetime", "webcal"]

    public static func decide(url: URL) -> NavigationDecision {
        guard let scheme = url.scheme?.lowercased(), allowedSchemes.contains(scheme) else {
            return .refuse
        }
        guard scheme == "https" else { return .openExternally }
        return isAllowed(host: url.host) ? .allow : .openExternally
    }

    public static let trapsInlineAttachmentsByDefault: Bool = {
        #if canImport(UIKit)
        true
        #else
        false
        #endif
    }()

    public static func decideResponse(
        canShowMIMEType: Bool,
        contentDisposition: String?,
        host: String? = nil,
        isMainFrame: Bool = false,
        trapsInlineAttachments: Bool = trapsInlineAttachmentsByDefault
    ) -> NavigationDecision {
        let disposition = (contentDisposition?.lowercased() ?? "").trimmingCharacters(in: .whitespaces)
        if disposition.hasPrefix("attachment") { return .download }
        if trapsInlineAttachments, isMainFrame, isAttachmentHost(host) { return .download }
        return canShowMIMEType ? .allow : .download
    }

    static func isAttachmentHost(_ host: String?) -> Bool {
        guard var host = host?.lowercased() else { return false }
        if host.hasSuffix(".") {
            host.removeLast()
        }
        return host == "fastmailusercontent.com" || host.hasSuffix(".fastmailusercontent.com")
    }

    static func isAllowed(host: String?) -> Bool {
        guard var host = host?.lowercased() else { return false }
        if host.hasSuffix(".") {
            host.removeLast()
        }
        return allowedHosts.contains { host == $0 || host.hasSuffix("." + $0) }
    }
}
