import Foundation
import Testing
@testable import FastmailShellKit

// The catalogue is the source of truth, but three JavaScript files carry a
// copy of it by hand: the userscript's own defaults, for a page running
// without a shell; the extension's options page; and the extension's
// background script. A key that reaches only some of them is a setting that
// works in some places and not others, which is exactly the bug nobody
// notices. This is the only thing that ties the four together.
private let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

private let mirrors = [
    "Userscript/fastmail-custom-mode.user.js",
    "SafariExtension/settings.js",
    "SafariExtension/background.js",
]

/// The `DEFAULT_SETTINGS` object literal of a mirror, as key to value, where
/// a value is a Bool or a String. Parsed rather than evaluated: the files are
/// not modules and cannot be imported into a Swift test.
private func defaults(inMirror path: String) throws -> [String: CustomModeSettings.Option.Value] {
    let source = try String(contentsOf: repoRoot.appendingPathComponent(path), encoding: .utf8)
    let opening = try #require(source.range(of: "DEFAULT_SETTINGS = {"))
    // The userscript closes its literal indented and the extension's two do
    // not, so the brace is found without one.
    let closing = try #require(source.range(of: "};", range: opening.upperBound..<source.endIndex))
    let body = source[opening.upperBound..<closing.lowerBound]

    var found: [String: CustomModeSettings.Option.Value] = [:]
    for line in body.split(separator: "\n") {
        let text = line.trimmingCharacters(in: .whitespaces)
        guard let colon = text.firstIndex(of: ":") else { continue }
        let key = String(text[text.startIndex..<colon])
        guard key.allSatisfy({ $0.isLetter || $0.isNumber }) else { continue }

        var value = String(text[text.index(after: colon)...])
            .trimmingCharacters(in: .whitespaces)
        if value.hasSuffix(",") { value.removeLast() }

        if value == "true" { found[key] = .toggle(true) }
        else if value == "false" { found[key] = .toggle(false) }
        else if value.hasPrefix("'") && value.hasSuffix("'") {
            let inner = String(value.dropFirst().dropLast())
            // The mirrors spell a newline the way JavaScript does.
            found[key] = .text(inner.replacingOccurrences(of: "\\n", with: "\n"))
        }
    }
    return found
}

@Test func everyMirrorCarriesEveryCatalogueKey() throws {
    for path in mirrors {
        let mirror = try defaults(inMirror: path)
        let catalogue = Set(CustomModeSettings.options.map(\.key))
        #expect(Set(mirror.keys) == catalogue, Comment(rawValue: path))
    }
}

@Test func everyMirrorCarriesEveryCatalogueDefault() throws {
    for path in mirrors {
        let mirror = try defaults(inMirror: path)
        for option in CustomModeSettings.options {
            #expect(
                mirror[option.key] == option.defaultValue,
                Comment(rawValue: "\(path): \(option.key)")
            )
        }
    }
}

// settings.js reads storage into inputs built from DEFAULT_SETTINGS' own
// keys, one document.getElementById per key; a key with no matching element
// in settings.html makes that lookup return null and the load path throw,
// taking the whole options page down rather than just that one field. The
// two tests above never look at the HTML at all, so this is the only thing
// that would catch a fourth mirror drifting.
@Test func settingsHTMLCarriesEveryCatalogueKey() throws {
    let source = try String(
        contentsOf: repoRoot.appendingPathComponent("SafariExtension/settings.html"),
        encoding: .utf8
    )
    for option in CustomModeSettings.options {
        #expect(source.contains("id=\"\(option.key)\""), Comment(rawValue: option.key))
    }
}
