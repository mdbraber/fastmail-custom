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
///
/// The app holds no mail and signs in to nothing. Everything it needs already
/// exists on the other side — both shells answer `compose?mailto=` and turn it
/// into Fastmail's compose page with the recipient, subject and body carried
/// across — so this only has to ask the question and forward the answer.
///
/// Note that iOS hands mailto: links to the default mail app and to nothing
/// else, and an app can only be that with Apple's `com.apple.developer.
/// mail-client` capability, which is granted by review. Until then this app is
/// reachable by its own scheme and from Shortcuts, and everything downstream
/// of the tap already works.
public enum MailtoChooser {
    /// The two shells, in the order the buttons are drawn. The schemes are the
    /// profiles' own: a rename on one side that did not reach the other would
    /// send mail into nowhere, so they are read from there rather than spelled
    /// out again here.
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
    ///
    /// Only a mailto is forwarded. The app is reachable by its own scheme as
    /// well, and an address arriving that way is not to be pushed into a
    /// compose window on trust.
    public static func compose(_ mailto: URL, in target: MailtoTarget) -> URL? {
        guard mailto.scheme?.lowercased() == "mailto" else { return nil }
        let command = "\(target.scheme)://compose?mailto=" + LinkRouter.percentEncode(mailto.absoluteString)
        return URL(string: command)
    }

    /// This app's own scheme, and the command it answers to on it.
    public static let scheme = "fastmail-mailto"

    /// The message a URL arriving at this app is asking to write, or nothing.
    ///
    /// A mailto: is itself the answer. Until Apple grants the Default Mail App
    /// capability iOS will not deliver one, though, so the app's own scheme is
    /// the way in meanwhile — from a Shortcut, or anything else that can open
    /// a URL — carrying the message in the same `compose?mailto=` command the
    /// shells answer to. Anything else arriving there is refused: an address
    /// that is not a mailto is not a message to write.
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

    /// What the link is about, for the chooser to show while it asks. A tap on
    /// a link you did not mean is caught here rather than in a compose window
    /// in the wrong account.
    ///
    /// Recipients live either after the colon or in a `to` field, and a link
    /// may carry several; both spellings are read, and what comes back is
    /// decoded for a person to look at rather than for a machine to parse.
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
