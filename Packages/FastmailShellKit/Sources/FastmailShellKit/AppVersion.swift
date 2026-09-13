import Foundation

/// The version the Device settings page shows, written the way Fastmail's own
/// app writes it: "1.0 (1)".
public enum AppVersion {
    public static func text(short: String?, build: String?) -> String {
        let short = (short ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let build = (build ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        switch (short.isEmpty, build.isEmpty) {
        case (false, false): return "\(short) (\(build))"
        case (false, true): return short
        case (true, false): return build
        case (true, true): return "Unknown"
        }
    }

    public static func text(infoDictionary: [String: Any]?) -> String {
        text(
            short: infoDictionary?["CFBundleShortVersionString"] as? String,
            build: infoDictionary?["CFBundleVersion"] as? String
        )
    }

    public static func text(bundle: Bundle = .main) -> String {
        text(infoDictionary: bundle.infoDictionary)
    }
}
