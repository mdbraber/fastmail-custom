import Foundation

public enum MetadataParser {
    private static let openMarker = "==UserScript=="
    private static let closeMarker = "==/UserScript=="

    public static func parse(_ source: String) throws -> UserScriptMetadata {
        let lines = source.components(separatedBy: .newlines)
        guard let start = lines.firstIndex(where: { $0.contains(openMarker) }) else {
            throw MetadataParseError.blockMissing
        }
        guard let end = lines[start...].firstIndex(where: { $0.contains(closeMarker) }) else {
            throw MetadataParseError.blockMissing
        }

        var name: String?
        var matches: [String] = []
        var runAt: UserScriptMetadata.RunAt = .documentIdle
        var grants: [String] = []

        for line in lines[(start + 1)..<end] {
            guard let (key, value) = directive(in: line) else { continue }
            switch key {
            case "name": name = value
            case "match": matches.append(value)
            case "run-at": runAt = UserScriptMetadata.RunAt(rawValue: value) ?? .documentIdle
            case "grant": grants.append(value)
            default: continue
            }
        }

        return UserScriptMetadata(name: name, matches: matches, runAt: runAt, grants: grants)
    }

    private static func directive(in line: String) -> (String, String)? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("//") else { return nil }
        let body = trimmed.dropFirst(2).trimmingCharacters(in: .whitespaces)
        guard body.hasPrefix("@") else { return nil }
        let content = body.dropFirst()
        guard let separator = content.firstIndex(where: { $0 == " " || $0 == "\t" }) else { return nil }
        let key = String(content[content.startIndex..<separator])
        let value = String(content[separator...]).trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty, !value.isEmpty else { return nil }
        return (key, value)
    }
}
