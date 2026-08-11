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
        let patterns = bundle.metadata.matches
        scripts.append(WKUserScript(
            source: guarded(bundle.userScript, patterns: patterns, label: "userscript"),
            injectionTime: time,
            forMainFrameOnly: true
        ))
        if let overlay = bundle.overlay {
            scripts.append(WKUserScript(
                source: guarded(overlay, patterns: patterns, label: "overlay"),
                injectionTime: time,
                forMainFrameOnly: true
            ))
        }
        return scripts
    }

    static func injectionTime(for runAt: UserScriptMetadata.RunAt) -> WKUserScriptInjectionTime {
        runAt == .documentStart ? .atDocumentStart : .atDocumentEnd
    }

    static func matches(_ patterns: [String], url: URL) -> Bool {
        guard !patterns.isEmpty else { return true }
        let href = normalizedHref(url)
        return patterns.contains { pattern in
            let escaped = NSRegularExpression.escapedPattern(for: pattern)
                .replacingOccurrences(of: "\\*", with: ".*")
            return href.range(of: "^" + escaped + "$", options: .regularExpression) != nil
        }
    }

    static func normalizedHref(_ url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        components.host = components.host?.lowercased()
        if components.path.isEmpty {
            components.path = "/"
        }
        return components.url?.absoluteString ?? url.absoluteString
    }

    static func guarded(_ source: String, patterns: [String], label: String) -> String {
        let patternsLiteral = jsonLiteral(patterns) ?? "[]"
        let labelLiteral = jsonLiteral(label) ?? "\"\""
        return #"""
        if ((function () {
        var patterns = \#(patternsLiteral);
        return !patterns.length || patterns.some(function (pattern) {
        var escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp('^' + escaped + '$').test(location.href);
        });
        })()) {
        try {\#(source)
        } catch (error) {
        var reported = {
        message: \#(labelLiteral) + ': ' + (error && error.message ? error.message : String(error)),
        stack: error && error.stack ? error.stack : ''
        };
        if (window.__fmshell && window.__fmshell.report) {
        window.__fmshell.report(reported);
        } else {
        console.error(reported.message, error);
        }
        }
        }
        """#
    }

    static func jsonLiteral(_ value: Any) -> String? {
        guard
            let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
            let text = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        return text
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
}
