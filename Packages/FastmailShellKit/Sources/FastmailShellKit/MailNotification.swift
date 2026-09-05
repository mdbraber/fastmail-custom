import Foundation

/// One notification as Fastmail's page hands it over — the service worker
/// already decided it should exist and wrote its words. `dataJSON` is the
/// worker's own click payload, kept verbatim so a click can hand it straight
/// back.
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
