import AppIntents
import FastmailShellKit
import Foundation

/// What Get Current Link hands to Shortcuts.
///
/// It is declared in the app rather than in FastmailShellKit. An entity from
/// the package reaches Shortcuts only if the app includes the package's App
/// Intents, and linkd cannot confirm an included package in these apps: it
/// fails to read the executable ("did not match any imported symbol") and
/// drops every action the app has. The name stays MailLink, so shortcuts that
/// already use its URL, Title or Markdown keep them.
struct MailLink: TransientAppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Mail Link"

    @Property(title: "URL")
    var url: URL

    @Property(title: "Title")
    var title: String

    @Property(title: "Markdown")
    var markdown: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)")
    }

    init() {}

    init(_ link: CurrentLink) {
        self.init()
        url = link.url
        title = link.title
        markdown = link.markdown
    }
}
