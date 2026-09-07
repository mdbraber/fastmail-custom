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
}
