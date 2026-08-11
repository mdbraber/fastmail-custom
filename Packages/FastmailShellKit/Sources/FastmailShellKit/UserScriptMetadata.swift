import Foundation

public struct UserScriptMetadata: Equatable, Sendable {
    public enum RunAt: String, Equatable, Sendable {
        case documentStart = "document-start"
        case documentEnd = "document-end"
        case documentIdle = "document-idle"
    }

    public let name: String?
    public let matches: [String]
    public let runAt: RunAt
    public let grants: [String]

    public init(name: String?, matches: [String], runAt: RunAt, grants: [String]) {
        self.name = name
        self.matches = matches
        self.runAt = runAt
        self.grants = grants
    }
}

public enum MetadataParseError: Error, Equatable {
    case blockMissing
}
