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

    /// Which message the notification is about. The Archive button acts on
    /// one message and this is the only thing in the payload that names it.
    public static func emailId(from userInfo: [AnyHashable: Any]) -> String? {
        guard let id = userInfo["emailId"] as? String, !id.isEmpty else { return nil }
        return id
    }
}

/// The buttons a notification carries, named the same here as in the push
/// server. iOS draws no buttons at all on a notification whose category it
/// does not know, so the two spellings have to stay in step.
public enum PushActions {
    /// Matches `ALERT_CATEGORY` in the server's notify.js.
    public static let category = "message"
    public static let archive = "archive"
}
