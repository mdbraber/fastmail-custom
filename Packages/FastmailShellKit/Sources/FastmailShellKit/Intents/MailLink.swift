import AppIntents
import Foundation

public struct MailLink: TransientAppEntity {
    public static let typeDisplayRepresentation: TypeDisplayRepresentation = "Mail Link"

    @Property(title: "URL")
    public var url: URL

    @Property(title: "Title")
    public var title: String

    @Property(title: "Markdown")
    public var markdown: String

    public var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)")
    }

    /// The link as markdown, built here rather than in the page so that it
    /// carries the same canonical address as the URL beside it.
    public static func markdown(title: String, url: URL) -> String {
        var escaped = ""
        for character in title {
            if character == "[" || character == "]" || character == "\\" { escaped.append("\\") }
            escaped.append(character)
        }
        return "[\(escaped)](\(url.absoluteString))"
    }

    public init() {}
}
