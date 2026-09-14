import Foundation

/// The message open in a page: its canonical address, its subject, and the
/// two together as a markdown link. The apps hand it to Shortcuts as their own
/// Mail Link entity. It is not an entity here, because an app that takes App
/// Intents from this package loses all of its actions in Shortcuts; MailLink
/// in Apps/Shared says why.
public struct CurrentLink: Sendable, Equatable {
    public let url: URL
    public let title: String
    public let markdown: String

    public init(url: URL, title: String) {
        self.url = url
        self.title = title
        self.markdown = Self.markdown(title: title, url: url)
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
}
