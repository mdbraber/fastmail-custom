import Foundation

/// What this device wants to hear about new mail: the Notifications page's
/// four boxed choices, and for Custom the senders and labels. The names are
/// the ones the page sends and the push server's `notify` takes.
public struct NotificationChoice: Equatable, Sendable, Codable {
    public enum Mode: String, Codable, Sendable, CaseIterable {
        case off, important, inbox, custom
    }

    public enum Senders: String, Codable, Sendable, CaseIterable {
        case everyone, contacts, vips
    }

    /// The push server refuses a longer list.
    public static let maxMailboxIds = 200

    public var mode: Mode
    public var senders: Senders
    public var mailboxIds: [String]

    public init(mode: Mode, senders: Senders = .everyone, mailboxIds: [String] = []) {
        self.mode = mode
        self.senders = senders
        self.mailboxIds = Self.cleaned(mailboxIds)
    }

    /// In order, without blanks or repeats, and no longer than the server takes.
    static func cleaned(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        let kept = ids.filter { !$0.isEmpty && seen.insert($0).inserted }
        return Array(kept.prefix(maxMailboxIds))
    }

    /// The fields as the page reads them and the server's `notify` takes them.
    public var jsonObject: [String: Any] {
        ["mode": mode.rawValue, "senders": senders.rawValue, "mailboxIds": mailboxIds]
    }

    public var json: String { Self.jsonText(jsonObject) }

    /// Sorted, so the same object always reads the same.
    static func jsonText(_ object: [String: Any]) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
            let text = String(data: data, encoding: .utf8)
        else { return "{}" }
        return text
    }

    /// Why a payload was refused; the message starts with the field's name.
    public struct Invalid: Error, Equatable {
        public let message: String
    }

    /// A choice sent by the page. Only `mode` is required; a missing or null
    /// `senders` is everyone and a missing or null `mailboxIds` is none.
    public static func parse(_ payload: [String: Any]) -> Result<NotificationChoice, Invalid> {
        guard let rawMode = payload["mode"] as? String, let mode = Mode(rawValue: rawMode) else {
            return .failure(Invalid(message: "mode must be off, important, inbox or custom"))
        }

        var senders = Senders.everyone
        if let value = payload["senders"], !(value is NSNull) {
            guard let raw = value as? String, let parsed = Senders(rawValue: raw) else {
                return .failure(Invalid(message: "senders must be everyone, contacts or vips"))
            }
            senders = parsed
        }

        var ids: [String] = []
        if let value = payload["mailboxIds"], !(value is NSNull) {
            guard let list = value as? [Any], list.count <= maxMailboxIds else {
                return .failure(Invalid(message: "mailboxIds must be a list of at most \(maxMailboxIds) labels"))
            }
            for item in list {
                guard let id = item as? String, !id.isEmpty else {
                    return .failure(Invalid(message: "mailboxIds must hold only non-empty strings"))
                }
                ids.append(id)
            }
        }

        return .success(NotificationChoice(mode: mode, senders: senders, mailboxIds: ids))
    }
}
