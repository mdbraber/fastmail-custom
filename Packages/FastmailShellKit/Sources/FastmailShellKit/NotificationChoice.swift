import Foundation

/// What this device wants to hear about new mail: the Notifications page's
/// four boxed choices, and for Custom the senders and the labels it includes
/// and excludes. The names are the ones the page sends and the push server's
/// `notify` takes.
public struct NotificationChoice: Equatable, Sendable, Codable {
    public enum Mode: String, Codable, Sendable, CaseIterable {
        case off, important, inbox, custom
    }

    public enum Senders: String, Codable, Sendable, CaseIterable {
        case everyone, contacts, vips
    }

    /// The push server refuses a longer list, of either kind.
    public static let maxMailboxIds = 200

    public var mode: Mode
    public var senders: Senders
    /// Custom notifies for a message in one of these labels...
    public var mailboxIds: [String]
    /// ...and in none of these.
    public var excludedMailboxIds: [String]

    public init(mode: Mode, senders: Senders = .everyone, mailboxIds: [String] = [], excludedMailboxIds: [String] = []) {
        self.mode = mode
        self.senders = senders
        self.mailboxIds = Self.cleaned(mailboxIds)
        self.excludedMailboxIds = Self.cleaned(excludedMailboxIds)
    }

    /// In order, without blanks or repeats, and no longer than the server takes.
    static func cleaned(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        let kept = ids.filter { !$0.isEmpty && seen.insert($0).inserted }
        return Array(kept.prefix(maxMailboxIds))
    }

    /// The fields as the page reads them and the server's `notify` takes them.
    public var jsonObject: [String: Any] {
        [
            "mode": mode.rawValue, "senders": senders.rawValue,
            "mailboxIds": mailboxIds, "excludedMailboxIds": excludedMailboxIds,
        ]
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
    /// `senders` is everyone and a missing or null label list is none.
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

        let included: [String]
        switch labels(payload["mailboxIds"], field: "mailboxIds") {
        case .failure(let invalid): return .failure(invalid)
        case .success(let ids): included = ids
        }
        let excluded: [String]
        switch labels(payload["excludedMailboxIds"], field: "excludedMailboxIds") {
        case .failure(let invalid): return .failure(invalid)
        case .success(let ids): excluded = ids
        }

        return .success(NotificationChoice(mode: mode, senders: senders, mailboxIds: included, excludedMailboxIds: excluded))
    }

    /// One of the label lists as the page sent it.
    private static func labels(_ value: Any?, field: String) -> Result<[String], Invalid> {
        guard let value, !(value is NSNull) else { return .success([]) }
        guard let list = value as? [Any], list.count <= maxMailboxIds else {
            return .failure(Invalid(message: "\(field) must be a list of at most \(maxMailboxIds) labels"))
        }
        var ids: [String] = []
        for item in list {
            guard let id = item as? String, !id.isEmpty else {
                return .failure(Invalid(message: "\(field) must hold only non-empty strings"))
            }
            ids.append(id)
        }
        return .success(ids)
    }
}
