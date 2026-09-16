import Foundation

/// One notification as Fastmail's page hands it over; the service worker
/// already decided it should exist and wrote its words.
public struct MailNotification: Equatable, Sendable {
    public let id: String
    public let title: String
    public let body: String
    public let sound: Bool
    public let threadId: String?
    public let dataJSON: String

    public init(id: String, title: String, body: String, sound: Bool, threadId: String?, dataJSON: String) {
        self.id = id
        self.title = title
        self.body = body
        self.sound = sound
        self.threadId = threadId
        self.dataJSON = dataJSON
    }

    public static func parse(_ payload: [String: Any]) -> MailNotification? {
        guard
            let id = payload["id"] as? String, !id.isEmpty,
            let title = payload["title"] as? String, !title.isEmpty
        else { return nil }
        let threadId = (payload["threadId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return MailNotification(
            id: id,
            title: title,
            body: payload["body"] as? String ?? "",
            sound: payload["sound"] as? Bool ?? false,
            threadId: threadId,
            dataJSON: payload["data"] as? String ?? "{}"
        )
    }
}

/// Message ids shown lately. The page can hand one message over twice, by
/// Fastmail's own notification and by the page script's fallback for the one
/// Fastmail drops, or once from each open window; it is shown once.
struct RecentNotificationIds {
    static let window: TimeInterval = 60 * 60

    private var shownAt: [String: Date] = [:]

    /// Whether the id was already shown within the window; if not, it counts
    /// as shown from now.
    mutating func isRepeat(_ id: String, now: Date = Date()) -> Bool {
        shownAt = shownAt.filter { now.timeIntervalSince($0.value) < Self.window }
        if shownAt[id] != nil { return true }
        shownAt[id] = now
        return false
    }
}
