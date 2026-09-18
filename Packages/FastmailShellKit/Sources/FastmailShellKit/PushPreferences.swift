import Foundation

/// This device's notification choice: one of the Notifications page's four
/// boxed options, and for Custom the senders and the labels it includes and
/// excludes. Kept in the app's own defaults, so Personal and Work each have
/// theirs, and changed only by the page, through the `setNotifications`
/// bridge action.
public enum PushPreferences {
    public static let modeKey = "push.mode"
    public static let sendersKey = "push.senders"
    public static let mailboxIdsKey = "push.mailboxIds"
    public static let excludedMailboxIdsKey = "push.excludedMailboxIds"
    /// Whether banners show the start of the message; on until turned off
    public static let previewsKey = "push.previews"
    /// What the push server's last registration reply said about reading the
    /// account's contacts; absent while no reply has said.
    public static let contactsKey = "push.contacts"
    /// The choice the push server last accepted, as JSON.
    static let acknowledgedKey = "push.acknowledged"
    /// The on/off switch the shell had before the page. Read once, to seed the
    /// choice, and never written again.
    static let legacyAlertsKey = "push.alerts"
    static let legacyAcknowledgedKey = "push.alertsAcknowledged"

    /// Run at launch: a device that has never had a choice gets the one its
    /// old switch meant. The old acknowledgement is dropped, so the choice is
    /// registered once under its new name.
    public static func migrate(in defaults: UserDefaults = .standard) {
        guard defaults.object(forKey: modeKey) == nil else { return }
        defaults.set(legacyMode(in: defaults).rawValue, forKey: modeKey)
        defaults.removeObject(forKey: legacyAcknowledgedKey)
    }

    /// Off when the old switch was turned off; otherwise All in inbox, which
    /// is what the switch did when on.
    static func legacyMode(in defaults: UserDefaults) -> NotificationChoice.Mode {
        (defaults.object(forKey: legacyAlertsKey) as? Bool ?? true) ? .inbox : .off
    }

    /// The saved choice. A value that is not one of the known names reads as
    /// its default rather than failing.
    public static func choice(in defaults: UserDefaults = .standard) -> NotificationChoice {
        let mode = defaults.string(forKey: modeKey).flatMap(NotificationChoice.Mode.init(rawValue:))
            ?? legacyMode(in: defaults)
        let senders = defaults.string(forKey: sendersKey).flatMap(NotificationChoice.Senders.init(rawValue:))
            ?? .everyone
        let included = defaults.array(forKey: mailboxIdsKey)?.compactMap { $0 as? String } ?? []
        let excluded = defaults.array(forKey: excludedMailboxIdsKey)?.compactMap { $0 as? String } ?? []
        return NotificationChoice(
            mode: mode, senders: senders, mailboxIds: included, excludedMailboxIds: excluded, previews: previews(in: defaults)
        )
    }

    /// Senders and both label lists are kept whatever the mode, so leaving
    /// Custom and coming back finds the lists as they were.
    public static func save(_ choice: NotificationChoice, in defaults: UserDefaults = .standard) {
        defaults.set(choice.mode.rawValue, forKey: modeKey)
        defaults.set(choice.senders.rawValue, forKey: sendersKey)
        defaults.set(choice.mailboxIds, forKey: mailboxIdsKey)
        defaults.set(choice.excludedMailboxIds, forKey: excludedMailboxIdsKey)
        defaults.set(choice.previews, forKey: previewsKey)
    }

    /// Read on its own by the Mac, which has no push choice but shows
    /// previews in the banners it draws itself.
    public static func previews(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: previewsKey) as? Bool ?? true
    }

    public static func setPreviews(_ enabled: Bool, in defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: previewsKey)
    }

    /// The Mac's excluded labels, read and written on their own: its other
    /// choices are Fastmail's, on Fastmail's own page.
    public static func excludedMailboxIds(in defaults: UserDefaults = .standard) -> [String] {
        NotificationChoice.cleaned(defaults.array(forKey: excludedMailboxIdsKey)?.compactMap { $0 as? String } ?? [])
    }

    public static func setExcludedMailboxIds(_ ids: [String], in defaults: UserDefaults = .standard) {
        defaults.set(NotificationChoice.cleaned(ids), forKey: excludedMailboxIdsKey)
    }

    public static func contacts(in defaults: UserDefaults = .standard) -> Bool? {
        defaults.object(forKey: contactsKey) as? Bool
    }

    /// Whether the server's idea of this device is stale: nothing was ever
    /// acknowledged, or the choice changed since.
    public static func registrationDue(in defaults: UserDefaults = .standard) -> Bool {
        guard
            let text = defaults.string(forKey: acknowledgedKey),
            let acknowledged = try? JSONDecoder().decode(NotificationChoice.self, from: Data(text.utf8))
        else { return true }
        return acknowledged != choice(in: defaults)
    }

    /// Called once the server accepted a registration carrying `choice`. The
    /// reply's contacts flag replaces the one kept, and a reply without one
    /// makes it unknown.
    public static func acknowledge(_ choice: NotificationChoice, contacts: Bool?, in defaults: UserDefaults = .standard) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        if let data = try? encoder.encode(choice), let text = String(data: data, encoding: .utf8) {
            defaults.set(text, forKey: acknowledgedKey)
        }
        if let contacts {
            defaults.set(contacts, forKey: contactsKey)
        } else {
            defaults.removeObject(forKey: contactsKey)
        }
    }
}
