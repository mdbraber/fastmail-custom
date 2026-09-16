import Foundation
import os
#if canImport(UIKit)
import UIKit
#endif

/// What the sync component needs from iCloud key-value storage. The apps
/// hand it `NSUbiquitousKeyValueStore.default`; the tests hand it a fake.
protocol KeyValueStore: AnyObject {
    func object(forKey key: String) -> Any?
    func set(_ value: Any?, forKey key: String)
    var dictionaryRepresentation: [String: Any] { get }
    func synchronize() -> Bool
}

/// Keeps Fastmail Custom's settings the same on the devices of one iCloud
/// account, for each Fastmail account, through iCloud key-value storage.
///
/// One per app process, serving every window. Settings stay where they have
/// always been, in `UserDefaults` under `fastmailCustom.`; this copies them to
/// and from the store under `<account id>.<setting>`, by the rules in
/// `SettingsSyncRules`. Its own state lives beside them under
/// `settingsSync.`, so it is neither synced nor handed to the page.
@MainActor
public final class FastmailCustomSettingsSync {
    nonisolated static let accountIdKey = "settingsSync.accountId"
    nonisolated static let enabledKey = "settingsSync.enabled"
    nonisolated static let joinedKeyPrefix = "settingsSync.joined."
    /// One flag per account, not per device type: this device's own device
    /// type is fixed for the process's lifetime, so no suffix is needed.
    nonisolated static let joinedBarKeyPrefix = "settingsSync.joinedBar."

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
    private let deviceType: @MainActor () -> SettingsSyncRules.DeviceType
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
        schedule: @escaping Schedule,
        deviceType: @escaping @MainActor () -> SettingsSyncRules.DeviceType
    ) {
        self.defaults = defaults
        self.store = store
        self.hasICloudIdentity = hasICloudIdentity
        self.now = now
        self.schedule = schedule
        self.deviceType = deviceType
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

    /// Whether this account's bar bucket (this device's own device type) has
    /// had its first sync on this device.
    func isJoinedBar(_ accountId: String) -> Bool {
        defaults.bool(forKey: Self.joinedBarKeyPrefix + accountId)
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
    /// to the store once the account (or, for a bar length, this device's
    /// bar bucket) has joined; until then, joining settles it.
    public func localChanged(key: String, value: Any) {
        guard isEnabled, let accountId, SettingsSyncRules.isSyncableValue(value) else { return }
        if SettingsSyncRules.deviceTypeKeys.contains(key) {
            guard isJoinedBar(accountId),
                  let entryKey = SettingsSyncRules.deviceTypeStoreKey(accountId: accountId, deviceType: deviceType(), key: key)
            else { return }
            store.set(value, forKey: entryKey)
        } else {
            guard isJoined(accountId), let entryKey = SettingsSyncRules.storeKey(accountId: accountId, key: key)
            else { return }
            store.set(value, forKey: entryKey)
        }
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
    /// they differ: this account's synced settings, plus this account's bar
    /// bucket for this device's own device type (a change from another
    /// device of a different type, or a different account, is ignored). They
    /// go into UserDefaults directly and never through `localChanged`, so
    /// nothing received is written back; the pusher and the home-screen
    /// shortcuts follow the defaults change as they always have.
    private func take(_ keys: [String]) {
        guard let accountId else { return }
        var changed: [String: Any] = [:]
        for key in keys {
            if let item = store.object(forKey: key) {
                changed[key] = item
            }
        }
        let local = FastmailCustomSettings.current(from: defaults)
        for (key, value) in SettingsSyncRules.settings(for: accountId, in: changed)
        where !SettingsSyncRules.sameValue(local[key], value) {
            defaults.set(value, forKey: FastmailCustomSettings.defaultsKey(for: key))
        }
        for (key, value) in SettingsSyncRules.deviceTypeSettings(for: accountId, deviceType: deviceType(), in: changed)
        where !SettingsSyncRules.sameValue(local[key], value) {
            defaults.set(value, forKey: FastmailCustomSettings.defaultsKey(for: key))
        }
    }

    /// The current account's first sync, if it has not had one, and its bar
    /// bucket's first sync (for this device's own device type), if that has
    /// not had one either. The two decisions share this launch's
    /// `firstSuccessfulSync`/`initialSyncArrived` clock but are otherwise
    /// independent: one may adopt while the other still waits to upload.
    func joinIfNeeded() {
        guard isEnabled, let accountId else { return }
        let plainNeeded = !isJoined(accountId)
        let barNeeded = !isJoinedBar(accountId)
        guard plainNeeded || barNeeded else { return }

        let identity = hasICloudIdentity()
        let synchronized = store.synchronize()
        if synchronized, identity, firstSuccessfulSync == nil {
            firstSuccessfulSync = now()
        }
        let secondsSinceSuccessfulSync = firstSuccessfulSync.map { now().timeIntervalSince($0) }
        if !identity, plainNeeded || barNeeded {
            log.notice("No iCloud account; Fastmail Custom settings stay on this device")
        }

        var nextRecheck: TimeInterval?
        func noteWait(_ recheckIn: TimeInterval?) {
            guard let recheckIn else { return }
            nextRecheck = min(nextRecheck ?? recheckIn, recheckIn)
        }

        if plainNeeded {
            let inStore = SettingsSyncRules.settings(for: accountId, in: store.dictionaryRepresentation)
            let decision = SettingsSyncRules.joinDecision(
                storeHasAccountKeys: !inStore.isEmpty,
                initialSyncArrived: initialSyncArrived,
                secondsSinceSuccessfulSync: secondsSinceSuccessfulSync,
                hasICloudIdentity: identity
            )
            switch decision {
            case .adopt:
                let plan = SettingsSyncRules.adoption(
                    local: FastmailCustomSettings.current(from: defaults), inStore: inStore
                )
                for (key, value) in plan.set {
                    defaults.set(value, forKey: FastmailCustomSettings.defaultsKey(for: key))
                }
                for key in plan.remove {
                    defaults.removeObject(forKey: FastmailCustomSettings.defaultsKey(for: key))
                }
                defaults.set(true, forKey: Self.joinedKeyPrefix + accountId)
                log.notice("Took this account's Fastmail Custom settings from iCloud")
            case .upload:
                let entries = SettingsSyncRules.storeEntries(
                    accountId: accountId, local: FastmailCustomSettings.current(from: defaults)
                )
                for (key, value) in entries {
                    store.set(value, forKey: key)
                }
                _ = store.synchronize()
                defaults.set(true, forKey: Self.joinedKeyPrefix + accountId)
                log.notice("Sent this device's Fastmail Custom settings to iCloud")
            case .wait(let recheckIn):
                noteWait(recheckIn)
            }
        }

        if barNeeded {
            let type = deviceType()
            let inStore = SettingsSyncRules.deviceTypeSettings(for: accountId, deviceType: type, in: store.dictionaryRepresentation)
            let decision = SettingsSyncRules.joinDecision(
                storeHasAccountKeys: !inStore.isEmpty,
                initialSyncArrived: initialSyncArrived,
                secondsSinceSuccessfulSync: secondsSinceSuccessfulSync,
                hasICloudIdentity: identity
            )
            switch decision {
            case .adopt:
                let local = FastmailCustomSettings.current(from: defaults).filter { SettingsSyncRules.deviceTypeKeys.contains($0.key) }
                let plan = SettingsSyncRules.deviceTypeAdoption(local: local, inStore: inStore)
                for (key, value) in plan.set {
                    defaults.set(value, forKey: FastmailCustomSettings.defaultsKey(for: key))
                }
                for key in plan.remove {
                    defaults.removeObject(forKey: FastmailCustomSettings.defaultsKey(for: key))
                }
                defaults.set(true, forKey: Self.joinedBarKeyPrefix + accountId)
                log.notice("Took this account's bar settings from iCloud")
            case .upload:
                let local = FastmailCustomSettings.current(from: defaults).filter { SettingsSyncRules.deviceTypeKeys.contains($0.key) }
                let entries = SettingsSyncRules.deviceTypeStoreEntries(accountId: accountId, deviceType: type, local: local)
                for (key, value) in entries {
                    store.set(value, forKey: key)
                }
                _ = store.synchronize()
                defaults.set(true, forKey: Self.joinedBarKeyPrefix + accountId)
                log.notice("Sent this device's bar settings to iCloud")
            case .wait(let recheckIn):
                noteWait(recheckIn)
            }
        }

        guard let nextRecheck, !recheckPending else { return }
        recheckPending = true
        schedule(nextRecheck) { [weak self] in
            self?.recheckPending = false
            self?.joinIfNeeded()
        }
    }

    private func clearJoined() {
        for key in defaults.dictionaryRepresentation().keys
        where key.hasPrefix(Self.joinedKeyPrefix) || key.hasPrefix(Self.joinedBarKeyPrefix) {
            defaults.removeObject(forKey: key)
        }
    }
}

extension NSUbiquitousKeyValueStore: KeyValueStore {}

@MainActor
public extension FastmailCustomSettingsSync {
    /// The one the app installed, or nothing where none was: the tests, the
    /// integration tests and the Mailto app.
    private(set) static var current: FastmailCustomSettingsSync?

    /// Makes the app's sync component on iCloud's own store and starts it;
    /// the same one when called again. The app's entry point calls this, so
    /// it exists before the first window builds its web view.
    @discardableResult
    static func install() -> FastmailCustomSettingsSync {
        if let current { return current }
        let sync = FastmailCustomSettingsSync(
            defaults: .standard,
            store: NSUbiquitousKeyValueStore.default,
            hasICloudIdentity: { FileManager.default.ubiquityIdentityToken != nil },
            schedule: { delay, work in
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    work()
                }
            },
            deviceType: {
                #if canImport(UIKit)
                return UIDevice.current.userInterfaceIdiom == .pad ? .ipad : .iphone
                #else
                return .mac
                #endif
            }
        )
        current = sync
        sync.start()
        return sync
    }
}
