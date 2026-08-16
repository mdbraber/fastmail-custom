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

    public init() {}
}
