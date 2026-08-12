import Foundation

public enum StartView {
    public static let defaultsKey = "startView"

    static let host = "app.fastmail.com"

    public static func resolve(_ raw: String?, default fallback: URL) -> URL {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: trimmed),
              url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host
        else { return fallback }
        return url
    }
}
