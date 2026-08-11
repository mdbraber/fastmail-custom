import Foundation
import WebKit

public enum ScriptInjector {
    @MainActor
    public static func userScripts(from bundle: ScriptBundle, url: URL) throws -> [WKUserScript] {
        var scripts = [
            WKUserScript(source: bundle.harness, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        ]
        guard matches(bundle.metadata.matches, url: url) else { return scripts }
        let time = injectionTime(for: bundle.metadata.runAt)
        scripts.append(WKUserScript(source: guarded(bundle.userScript), injectionTime: time, forMainFrameOnly: true))
        if let overlay = bundle.overlay {
            scripts.append(WKUserScript(source: guarded(overlay), injectionTime: time, forMainFrameOnly: true))
        }
        return scripts
    }

    static func injectionTime(for runAt: UserScriptMetadata.RunAt) -> WKUserScriptInjectionTime {
        runAt == .documentStart ? .atDocumentStart : .atDocumentEnd
    }

    static func matches(_ patterns: [String], url: URL) -> Bool {
        guard !patterns.isEmpty else { return true }
        let href = url.absoluteString
        return patterns.contains { pattern in
            let escaped = NSRegularExpression.escapedPattern(for: pattern)
                .replacingOccurrences(of: "\\*", with: ".*")
            return href.range(of: "^" + escaped + "$", options: .regularExpression) != nil
        }
    }

    static func guarded(_ source: String) -> String {
        "try {\n" + source + "\n} catch (error) {\n  window.__fmshell && window.__fmshell.report(error);\n}"
    }
}
