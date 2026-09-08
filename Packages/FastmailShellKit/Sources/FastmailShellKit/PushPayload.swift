import Foundation

/// The one thing the app reads out of a push: the thread's address the
/// server put in `url`. Only https is taken here; LinkRouter still gets to
/// refuse anything that is not Fastmail's.
public enum PushPayload {
    public static func url(from userInfo: [AnyHashable: Any]) -> URL? {
        guard
            let text = userInfo["url"] as? String,
            let url = URL(string: text),
            url.scheme?.lowercased() == "https"
        else { return nil }
        return url
    }

    /// Which message the notification is about. A button acts on one message
    /// and this is the only thing in the payload that names it.
    public static func emailId(from userInfo: [AnyHashable: Any]) -> String? {
        guard let id = userInfo["emailId"] as? String, !id.isEmpty else { return nil }
        return id
    }
}

/// The buttons a notification carries, named the same here as in the push
/// server, which does the work: each raw value is one of the names its
/// `/actions` route accepts. iOS draws no buttons at all on a notification
/// whose category it does not know, so the spellings have to stay in step.
///
/// The order is the order they are drawn, and that is the whole of the
/// priority — iOS shows the first four and nothing else, and the buttons only
/// appear once a banner is pulled down, so a long list is a menu to read
/// rather than a tap saved. Three verbs, and the commonest first.
public enum PushAction: String, CaseIterable {
    case archive
    case later
    case pin

    /// Matches `ALERT_CATEGORY` in the server's notify.js.
    public static let category = "message"

    /// What the button says.
    public var title: String {
        switch self {
        case .archive: return "Archive"
        case .later: return "Later"
        case .pin: return "Pin"
        }
    }

    /// Said as a notification of its own when the press does not land. The
    /// banner is gone by then, so a failure that said nothing would look
    /// exactly like a success.
    public var failureTitle: String {
        switch self {
        case .archive: return "Not archived"
        case .later: return "Not filed"
        case .pin: return "Not pinned"
        }
    }

    public var failureBody: String {
        switch self {
        case .archive: return "The message is still in your Inbox."
        case .later: return "The message was not filed under Later."
        case .pin: return "The message was not pinned."
        }
    }
}
