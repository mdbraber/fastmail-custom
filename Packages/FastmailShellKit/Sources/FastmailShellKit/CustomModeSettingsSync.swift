import Foundation
import os

/// What the sync component needs from iCloud key-value storage. The apps
/// hand it `NSUbiquitousKeyValueStore.default`; the tests hand it a fake.
protocol KeyValueStore: AnyObject {
    func object(forKey key: String) -> Any?
    func set(_ value: Any?, forKey key: String)
    var dictionaryRepresentation: [String: Any] { get }
    func synchronize() -> Bool
}

/// Keeps Custom mode's settings the same on the devices of one iCloud
/// account, for each Fastmail account, through iCloud key-value storage.
///
/// One per app process, serving every window. Settings stay where they have
/// always been, in `UserDefaults` under `customMode.`; this copies them to
/// and from the store under `<account id>.<setting>`, by the rules in
/// `SettingsSyncRules`. Its own state lives beside them under
/// `settingsSync.`, so it is neither synced nor handed to the page.
@MainActor
public final class CustomModeSettingsSync {
    nonisolated static let accountIdKey = "settingsSync.accountId"
    nonisolated static let enabledKey = "settingsSync.enabled"
    nonisolated static let joinedKeyPrefix = "settingsSync.joined."

    /// Why the store says it changed, numbered as Foundation numbers them.
    enum ChangeReason: Int {
        case serverChange = 0
        case initialSync = 1
        case quotaViolation = 2
        case accountChange = 3
    }

    /// Runs work on the main actor after a delay: a timer in the apps, a list
    /// the test runs by hand.
    typealias Schedule = @MainActor (TimeInterval, @escaping @MainActor @Sendable () -> Void) -> Void

    private let defaults: UserDefaults
    private let store: KeyValueStore
    private let hasICloudIdentity: @MainActor () -> Bool
    private let now: @MainActor () -> Date
    private let schedule: Schedule
    private let log = Logger(subsystem: "com.mdbraber.fastmail-custom", category: "settings-sync")
    /// Whether this launch has heard the store's first download finish.
    private var initialSyncArrived = false
    /// This launch's first successful synchronize, where the 30 seconds start.
    private var firstSuccessfulSync: Date?
    private var recheckPending = false
    // Written once in start, read again only from deinit; never concurrently
    private nonisolated(unsafe) var observer: NSObjectProtocol?

    init(
        defaults: UserDefaults,
        store: KeyValueStore,
        hasICloudIdentity: @escaping @MainActor () -> Bool,
        now: @escaping @MainActor () -> Date = { Date() },
        schedule: @escaping Schedule
    ) {
        self.defaults = defaults
        self.store = store
        self.hasICloudIdentity = hasICloudIdentity
        self.now = now
        self.schedule = schedule
    }

    deinit {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// Whether this app syncs: on until the settings page switches it off.
    nonisolated static func isEnabled(in defaults: UserDefaults) -> Bool {
        defaults.object(forKey: enabledKey) as? Bool ?? true
    }

    public var isEnabled: Bool { Self.isEnabled(in: defaults) }

    /// The account the last page reported, kept across launches so the app
    /// can sync before any page has loaded.
    var accountId: String? {
        guard let stored = defaults.string(forKey: Self.accountIdKey),
              SettingsSyncRules.isValidAccountId(stored) else { return nil }
        return stored
    }

    func isJoined(_ accountId: String) -> Bool {
        defaults.bool(forKey: Self.joinedKeyPrefix + accountId)
    }

    /// Listens for other devices' changes, and joins the last known account
    /// at once, without waiting for a page.
    func start() {
        if observer == nil {
            observer = NotificationCenter.default.addObserver(
                forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
                object: store,
                queue: .main
            ) { [weak self] notification in
                let reason = notification.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int ?? -1
                let keys = notification.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? []
                MainActor.assumeIsolated { self?.externalChange(reason: reason, keys: keys) }
            }
        }
        joinIfNeeded()
    }

    /// A page said which Fastmail account it is. A different account from
    /// the last one switches to its keys and joins it.
    public func accountReported(_ accountId: String) {
        guard SettingsSyncRules.isValidAccountId(accountId) else { return }
        if defaults.string(forKey: Self.accountIdKey) != accountId {
            defaults.set(accountId, forKey: Self.accountIdKey)
        }
        joinIfNeeded()
    }

    /// The page changed a setting, which the app has already saved. It goes
    /// to the store once the account has joined; until then, joining settles
    /// it.
    public func localChanged(key: String, value: Any) {
        guard isEnabled, let accountId, isJoined(accountId),
              let entryKey = SettingsSyncRules.storeKey(accountId: accountId, key: key),
              SettingsSyncRules.isSyncableValue(value)
        else { return }
        store.set(value, forKey: entryKey)
    }

    /// The settings page's "Sync settings with iCloud" switch. Off keeps
    /// every setting as it is and forgets every account's first sync; on
    /// joins again, so iCloud's settings win when it has some.
    public func setEnabled(_ enabled: Bool) {
        defaults.set(enabled, forKey: Self.enabledKey)
        if enabled {
            joinIfNeeded()
        } else {
            clearJoined()
        }
    }

    /// What the store's change notice said.
    func externalChange(reason: Int, keys: [String]) {
        guard isEnabled else { return }
        guard let known = ChangeReason(rawValue: reason) else {
            log.error("iCloud key-value storage changed for an unknown reason: \(reason)")
            return
        }
        switch known {
        case .serverChange:
            take(keys)
            // A device still waiting to join may now find its account there
            joinIfNeeded()
        case .initialSync:
            initialSyncArrived = true
            take(keys)
            joinIfNeeded()
        case .accountChange:
            // Another iCloud account's store: nothing joined before counts,
            // and its download starts over
            log.notice("The iCloud account changed; joining again")
            initialSyncArrived = false
            firstSuccessfulSync = nil
            clearJoined()
            joinIfNeeded()
        case .quotaViolation:
            log.error("iCloud key-value storage is over quota; settings stay on this device")
        }
    }

    /// Values another device wrote, taken into this device's settings where
    /// they differ: this account's synced settings only. They go into
    /// UserDefaults directly and never through `localChanged`, so nothing
    /// received is written back; the pusher and the home-screen shortcuts
    /// follow the defaults change as they always have.
    private func take(_ keys: [String]) {
        guard let accountId else { return }
        var changed: [String: Any] = [:]
        for key in keys {
            if let item = store.object(forKey: key) {
                changed[key] = item
            }
        }
        let local = CustomModeSettings.current(from: defaults)
        for (key, value) in SettingsSyncRules.settings(for: accountId, in: changed)
        where !SettingsSyncRules.sameValue(local[key], value) {
            defaults.set(value, forKey: CustomModeSettings.defaultsKey(for: key))
        }
    }

    /// The current account's first sync, if it has not had one.
    func joinIfNeeded() {
        guard isEnabled, let accountId, !isJoined(accountId) else { return }
        let identity = hasICloudIdentity()
        let synchronized = store.synchronize()
        if synchronized, identity, firstSuccessfulSync == nil {
            firstSuccessfulSync = now()
        }
        let inStore = SettingsSyncRules.settings(for: accountId, in: store.dictionaryRepresentation)
        let decision = SettingsSyncRules.joinDecision(
            storeHasAccountKeys: !inStore.isEmpty,
            initialSyncArrived: initialSyncArrived,
            secondsSinceSuccessfulSync: firstSuccessfulSync.map { now().timeIntervalSince($0) },
            hasICloudIdentity: identity
        )
        switch decision {
        case .adopt:
            let plan = SettingsSyncRules.adoption(
                local: CustomModeSettings.current(from: defaults), inStore: inStore
            )
            for (key, value) in plan.set {
                defaults.set(value, forKey: CustomModeSettings.defaultsKey(for: key))
            }
            for key in plan.remove {
                defaults.removeObject(forKey: CustomModeSettings.defaultsKey(for: key))
            }
            defaults.set(true, forKey: Self.joinedKeyPrefix + accountId)
            log.notice("Took this account's Custom mode settings from iCloud")
        case .upload:
            let entries = SettingsSyncRules.storeEntries(
                accountId: accountId, local: CustomModeSettings.current(from: defaults)
            )
            for (key, value) in entries {
                store.set(value, forKey: key)
            }
            _ = store.synchronize()
            defaults.set(true, forKey: Self.joinedKeyPrefix + accountId)
            log.notice("Sent this device's Custom mode settings to iCloud")
        case .wait(let recheckIn):
            if !identity {
                log.notice("No iCloud account; Custom mode settings stay on this device")
            }
            guard let recheckIn, !recheckPending else { return }
            recheckPending = true
            schedule(recheckIn) { [weak self] in
                self?.recheckPending = false
                self?.joinIfNeeded()
            }
        }
    }

    private func clearJoined() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(Self.joinedKeyPrefix) {
            defaults.removeObject(forKey: key)
        }
    }
}
