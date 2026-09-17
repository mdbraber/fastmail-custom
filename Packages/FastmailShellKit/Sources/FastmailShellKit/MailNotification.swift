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
    /// The sender's picture Fastmail's service worker found, or the contact
    /// photo the page script looked up for its fallback; shown beside the text.
    public let image: NotificationImage?

    public init(id: String, title: String, body: String, sound: Bool, threadId: String?, dataJSON: String,
                image: NotificationImage? = nil) {
        self.id = id
        self.title = title
        self.body = body
        self.sound = sound
        self.threadId = threadId
        self.dataJSON = dataJSON
        self.image = image
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
            dataJSON: payload["data"] as? String ?? "{}",
            image: (payload["icon"] as? String).flatMap(NotificationImage.parse(dataURL:))
        )
    }
}

/// A picture handed over as a data: URL, the form Fastmail's service worker
/// already gives its notification icon. Only image types, only base64, and
/// only small: a contact photo is asked for at 212 pixels, some 20 KB.
public struct NotificationImage: Equatable, Sendable {
    static let maxBytes = 2 * 1024 * 1024
    static let mediaTypes: Set<String> = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]

    public let mediaType: String
    public let data: Data

    public static func parse(dataURL: String) -> NotificationImage? {
        guard dataURL.hasPrefix("data:"), let comma = dataURL.firstIndex(of: ",") else { return nil }
        let header = dataURL[dataURL.index(dataURL.startIndex, offsetBy: 5)..<comma].lowercased()
        let parts = header.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
        guard let mediaType = parts.first, mediaTypes.contains(mediaType), parts.contains("base64") else { return nil }
        let encoded = dataURL[dataURL.index(after: comma)...]
        // Base64 runs a third longer than what it holds
        guard encoded.count <= maxBytes / 3 * 4 + 4,
              let data = Data(base64Encoded: String(encoded), options: .ignoreUnknownCharacters),
              !data.isEmpty, data.count <= maxBytes
        else { return nil }
        return NotificationImage(mediaType: mediaType, data: data)
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
