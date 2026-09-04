import Foundation

public enum StartView {
    public static let defaultsKey = "startView"

    /// A start URL says which view to open, not which server to open it on:
    /// that is the backend's question. So an address on either known host is
    /// accepted and then moved onto the selected backend, and the two settings
    /// compose instead of contradicting each other. Were it otherwise, a start
    /// URL left over from the other server would quietly load a page the
    /// native bridge is not expecting and refuses to talk to.
    public static func resolve(
        _ raw: String?,
        default fallback: URL,
        backend: Backend = .production
    ) -> URL {
        let onBackend = backend.rehost(fallback)
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: trimmed),
              url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(),
              Backend.knownHosts.contains(host)
        else { return onBackend }
        return backend.rehost(url)
    }
}
