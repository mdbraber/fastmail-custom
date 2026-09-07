import Foundation

public enum StartView {
    public static let defaultsKey = "startView"

    /// The setting is a path — which view to open — not a server: the server
    /// is the backend's question. The path is placed on the selected backend,
    /// so the two settings compose instead of contradicting each other. Empty
    /// means the default view. A full web address is tolerated but reduced to
    /// its path, and rejected if it names another host or an insecure scheme,
    /// so a stale full URL cannot smuggle in a page the native bridge refuses
    /// to talk to.
    public static func resolve(
        _ raw: String?,
        default fallback: URL,
        backend: Backend = .standard
    ) -> URL {
        let onBackend = backend.rehost(fallback)
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return onBackend }

        // Normally the field holds just a path. A pasted full address is
        // reduced to its path here; anything on another host or a non-https
        // scheme is refused rather than silently rehosted.
        var pathSource = trimmed
        if let typed = URLComponents(string: trimmed), typed.scheme != nil {
            guard typed.scheme?.lowercased() == "https",
                  let host = typed.host?.lowercased(),
                  Backend.knownHosts.contains(host)
            else { return onBackend }
            pathSource = typed.percentEncodedPath
            if let query = typed.percentEncodedQuery { pathSource += "?" + query }
            if let fragment = typed.percentEncodedFragment { pathSource += "#" + fragment }
        }
        if !pathSource.hasPrefix("/") { pathSource = "/" + pathSource }

        guard let parsed = URLComponents(string: pathSource) else { return onBackend }
        var out = URLComponents()
        out.scheme = "https"
        out.host = backend.host
        out.percentEncodedPath = parsed.percentEncodedPath.isEmpty ? "/" : parsed.percentEncodedPath
        out.percentEncodedQuery = parsed.percentEncodedQuery
        out.percentEncodedFragment = parsed.percentEncodedFragment
        return out.url ?? onBackend
    }
}
