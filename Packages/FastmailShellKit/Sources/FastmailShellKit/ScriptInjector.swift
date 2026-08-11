import Foundation

public enum ScriptInjectorError: Error, Equatable {
    case encodingFailed(String)
}

public enum ScriptInjector {
    public static func bootstrap(from bundle: ScriptBundle) throws -> String {
        guard let userScript = jsonLiteral(bundle.userScript) else {
            throw ScriptInjectorError.encodingFailed("userScript")
        }
        let overlay: String
        if let bundleOverlay = bundle.overlay {
            guard let encodedOverlay = jsonLiteral(bundleOverlay) else {
                throw ScriptInjectorError.encodingFailed("overlay")
            }
            overlay = encodedOverlay
        } else {
            overlay = "null"
        }
        guard let metadata = jsonLiteral([
            "runAt": bundle.metadata.runAt.rawValue,
            "matches": bundle.metadata.matches
        ]) else {
            throw ScriptInjectorError.encodingFailed("metadata")
        }
        return """
        \(bundle.harness)
        window.__fmshell.boot(\(userScript), \(overlay), \(metadata));
        """
    }

    static func jsonLiteral(_ value: String) -> String? {
        jsonLiteral(value as Any)
    }

    static func jsonLiteral(_ value: Any) -> String? {
        guard
            let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
            let text = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        return text
    }
}
