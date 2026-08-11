import Foundation

public enum ScriptInjector {
    public static func bootstrap(from bundle: ScriptBundle) -> String {
        let userScript = jsonLiteral(bundle.userScript)
        let overlay = bundle.overlay.map(jsonLiteral) ?? "null"
        let metadata = jsonLiteral([
            "runAt": bundle.metadata.runAt.rawValue,
            "matches": bundle.metadata.matches
        ])
        return """
        \(bundle.harness)
        window.__fmshell.boot(\(userScript), \(overlay), \(metadata));
        """
    }

    static func jsonLiteral(_ value: String) -> String {
        jsonLiteral(value as Any)
    }

    static func jsonLiteral(_ value: Any) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
            let text = String(data: data, encoding: .utf8)
        else {
            return "null"
        }
        return text
    }
}
