import Foundation

/// What a mailto link is about, in the two lines worth showing before you
/// send it somewhere.
public struct MailtoSummary: Equatable, Sendable {
    /// Everyone it is addressed to, comma-separated and readable. Empty when
    /// the link names nobody, which is still a message worth writing.
    public let recipients: String
    public let subject: String?
}

/// One of the two shells, as a button in the chooser app.
public struct MailtoTarget: Identifiable, Equatable, Sendable {
    /// The profile this stands for.
    public let id: String
    /// What the button says.
    public let title: String
    /// The name the app wears on the home screen, so the button says which
    /// app it means rather than leaving you to remember which is which.
    public let subtitle: String
    /// The scheme that app answers to.
    public let scheme: String
}

/// The chooser app: a mailto link arrives, you say which account it is from,
/// and it goes to that shell's compose window.
public enum MailtoChooser {
    /// The two shells, in the order the buttons are drawn.
    public static let targets: [MailtoTarget] = [
        MailtoTarget(
            id: "personal",
            title: "Personal",
            subtitle: Profile.personal(accountID: nil).displayName,
            scheme: Profile.personal(accountID: nil).urlScheme
        ),
        MailtoTarget(
            id: "work",
            title: "Work",
            subtitle: Profile.work(accountID: nil).displayName,
            scheme: Profile.work(accountID: nil).urlScheme
        ),
    ]

    /// The command that opens this message in that shell's compose window.
    public static func compose(_ mailto: URL, in target: MailtoTarget) -> URL? {
        guard mailto.scheme?.lowercased() == "mailto" else { return nil }
        let command = "\(target.scheme)://compose?mailto=" + LinkRouter.percentEncode(mailto.absoluteString)
        return URL(string: command)
    }

    /// This app's own scheme, and the command it answers to on it.
    public static let scheme = "fastmail-mailto"

    /// The message a URL arriving at this app is asking to write, or nothing.
    public static func incoming(_ url: URL) -> URL? {
        if url.scheme?.lowercased() == "mailto" { return url }
        guard
            url.scheme?.lowercased() == scheme,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            (components.host ?? "").lowercased() == "compose",
            let raw = (components.queryItems ?? []).first(where: { $0.name == "mailto" })?.value,
            raw.lowercased().hasPrefix("mailto:")
        else { return nil }
        return URL(string: raw)
    }

    /// What the link is about, for the chooser to show while it asks.
    public static func summary(of mailto: URL) -> MailtoSummary? {
        guard
            mailto.scheme?.lowercased() == "mailto",
            let components = URLComponents(url: mailto, resolvingAgainstBaseURL: false)
        else { return nil }

        let items = components.queryItems ?? []
        let field = { (name: String) in
            items.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.value
        }
        let listed = components.path.isEmpty ? (field("to") ?? "") : components.path
        let recipients = listed
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        let subject = field("subject")?.trimmingCharacters(in: .whitespaces)

        return MailtoSummary(
            recipients: recipients,
            subject: (subject?.isEmpty ?? true) ? nil : subject
        )
    }
}
