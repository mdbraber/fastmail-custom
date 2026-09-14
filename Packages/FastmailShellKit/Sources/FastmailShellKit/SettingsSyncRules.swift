import Foundation

/// The rules for keeping Custom mode's settings in iCloud key-value storage:
/// what a store key looks like, which settings travel, what a first sync
/// decides, and what the Safari extension's native part answers.
///
/// Foundation and nothing else from this package. The Safari extension
/// compiles this same file by reference, in Swift 5 and for an older macOS,
/// so the apps and the extension cannot disagree about a key.
enum SettingsSyncRules {
    /// Between the account id and the setting: `u1234abcd.labelColours`.
    static let keySeparator = "."

    /// How many actions fit on a bar depends on the screen, so these two
    /// sync per device type (`mac`, `iphone`, `ipad`) instead of per account:
    /// every device of the same type shares one value, rather than sharing
    /// with every device on the account or staying on a single device.
    static let deviceTypeKeys: Set<String> = ["bottomBarItems", "topBarItems"]

    /// The store key segment marking a device-type key, between the account
    /// id and the device type: `u1234abcd.bar.mac.bottomBarItems`. Makes the
    /// two key formats unambiguous to parse, since a plain key never has more
    /// than one `.` and a device-type key always has exactly three.
    static let deviceTypeMarker = "bar"

    /// With the longest setting name, a key stays inside iCloud's limit.
    static let maxAccountIdLength = 32
    static let maxStoreKeyBytes = 64

    /// The kind of device a key's bucket belongs to. Safari's device type is
    /// always `.mac`; the apps read `UIDevice.current.userInterfaceIdiom`.
    enum DeviceType: String, CaseIterable {
        case mac, iphone, ipad
    }

    /// How long an app believes an empty store may still be downloading,
    /// counted from its first successful synchronize.
    static let uploadGrace: TimeInterval = 30

    // MARK: Keys

    /// A Fastmail account id as the page reports it: 1 to 32 ASCII letters,
    /// digits, hyphens and underscores.
    static func isValidAccountId(_ accountId: String) -> Bool {
        guard !accountId.isEmpty, accountId.utf8.count <= maxAccountIdLength else { return false }
        return accountId.unicodeScalars.allSatisfy { isLetter($0) || isDigit($0) || $0 == "-" || $0 == "_" }
    }

    /// `CustomModeSettings.isWritableSettingKey`'s rule, letters and digits
    /// starting with a letter, written again so this file stands alone. A
    /// package test holds the two together.
    static func isSettingKey(_ key: String) -> Bool {
        guard let first = key.unicodeScalars.first, isLetter(first) else { return false }
        return key.unicodeScalars.allSatisfy { isLetter($0) || isDigit($0) }
    }

    /// A setting that travels between devices in the plain, per-account key
    /// space. The device-type keys still travel, through the separate
    /// device-type key space, so this keeps refusing them here to force them
    /// through `deviceTypeStoreKey`/`parseDeviceTypeKey` instead.
    static func isSyncedKey(_ key: String) -> Bool {
        isSettingKey(key) && !deviceTypeKeys.contains(key)
    }

    /// The store key for one account's setting, or nothing when the account,
    /// the setting or the length will not do.
    static func storeKey(accountId: String, key: String) -> String? {
        guard isValidAccountId(accountId), isSyncedKey(key) else { return nil }
        let joined = accountId + keySeparator + key
        return joined.utf8.count <= maxStoreKeyBytes ? joined : nil
    }

    /// The account and setting a store key names, or nothing for a key that
    /// is not a synced setting.
    static func parse(storeKey: String) -> (accountId: String, key: String)? {
        guard let separator = storeKey.range(of: keySeparator) else { return nil }
        let accountId = String(storeKey[..<separator.lowerBound])
        let key = String(storeKey[separator.upperBound...])
        guard isValidAccountId(accountId), isSyncedKey(key) else { return nil }
        return (accountId, key)
    }

    /// The store key for one account's device-type setting, or nothing when
    /// the account, the key or the length will not do.
    static func deviceTypeStoreKey(accountId: String, deviceType: DeviceType, key: String) -> String? {
        guard isValidAccountId(accountId), deviceTypeKeys.contains(key) else { return nil }
        let joined = [accountId, deviceTypeMarker, deviceType.rawValue, key].joined(separator: keySeparator)
        return joined.utf8.count <= maxStoreKeyBytes ? joined : nil
    }

    /// The account, device type and setting a device-type store key names, or
    /// nothing for a key that is not a device-type setting for a known device
    /// type.
    static func parseDeviceTypeKey(storeKey: String) -> (accountId: String, deviceType: DeviceType, key: String)? {
        let parts = storeKey.components(separatedBy: keySeparator)
        guard parts.count == 4, parts[1] == deviceTypeMarker else { return nil }
        let accountId = parts[0]
        let key = parts[3]
        guard isValidAccountId(accountId), deviceTypeKeys.contains(key),
              let deviceType = DeviceType(rawValue: parts[2]) else { return nil }
        return (accountId, deviceType, key)
    }

    // MARK: Values

    /// Booleans and strings are all the settings hold. A JavaScript 1 and a
    /// JavaScript true both arrive as NSNumber, so CoreFoundation is asked
    /// which one it is, as the bridge's `setting` action does.
    static func isSyncableValue(_ item: Any) -> Bool {
        settingValue(item) != nil
    }

    /// Both booleans and equal, or both strings and equal.
    static func sameValue(_ one: Any?, _ other: Any?) -> Bool {
        guard let one, let other, let first = settingValue(one), let second = settingValue(other) else {
            return false
        }
        return first == second
    }

    private enum SettingValue: Equatable {
        case flag(Bool)
        case text(String)
    }

    private static func settingValue(_ item: Any) -> SettingValue? {
        if let number = item as? NSNumber {
            guard CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() else { return nil }
            return .flag(number.boolValue)
        }
        if let text = item as? String {
            return .text(text)
        }
        return nil
    }

    private static func plain(_ value: SettingValue) -> Any {
        switch value {
        case .flag(let flag): return flag
        case .text(let text): return text
        }
    }

    // MARK: Settings

    /// One account's synced settings in the store's contents, without the
    /// prefix. Other accounts, device-type settings (a separate key space:
    /// see `deviceTypeSettings`) and values that are neither a boolean nor a
    /// string are left out.
    static func settings(for accountId: String, in contents: [String: Any]) -> [String: Any] {
        var settings: [String: Any] = [:]
        for (entryKey, item) in contents {
            guard let parsed = parse(storeKey: entryKey), parsed.accountId == accountId,
                  let value = settingValue(item) else { continue }
            settings[parsed.key] = plain(value)
        }
        return settings
    }

    /// A device's settings as store entries for one account: the synced ones,
    /// each under its prefixed key.
    static func storeEntries(accountId: String, local: [String: Any]) -> [String: Any] {
        var entries: [String: Any] = [:]
        for (key, item) in local {
            guard let entryKey = storeKey(accountId: accountId, key: key),
                  let value = settingValue(item) else { continue }
            entries[entryKey] = plain(value)
        }
        return entries
    }

    /// One account's device-type settings in the store's contents, without
    /// the prefix. Other accounts, other device types and values that are
    /// neither a boolean nor a string are left out.
    static func deviceTypeSettings(for accountId: String, deviceType: DeviceType, in contents: [String: Any]) -> [String: Any] {
        var settings: [String: Any] = [:]
        for (entryKey, item) in contents {
            guard let parsed = parseDeviceTypeKey(storeKey: entryKey), parsed.accountId == accountId,
                  parsed.deviceType == deviceType, let value = settingValue(item) else { continue }
            settings[parsed.key] = plain(value)
        }
        return settings
    }

    /// A device's device-type settings as store entries for one account and
    /// device type: the device-type ones, each under its prefixed key.
    static func deviceTypeStoreEntries(accountId: String, deviceType: DeviceType, local: [String: Any]) -> [String: Any] {
        var entries: [String: Any] = [:]
        for (key, item) in local {
            guard let entryKey = deviceTypeStoreKey(accountId: accountId, deviceType: deviceType, key: key),
                  let value = settingValue(item) else { continue }
            entries[entryKey] = plain(value)
        }
        return entries
    }

    // MARK: Joining

    /// What a device that has not synced an account yet does.
    enum JoinDecision: Equatable {
        /// The store has the account's settings: take them.
        case adopt
        /// The store is empty for the account and can be believed: send this
        /// device's settings.
        case upload
        /// Not yet. Look again after this many seconds, or, when nil, at the
        /// next launch, page report or change notice.
        case wait(recheckIn: TimeInterval?)
    }

    /// Without an iCloud account nothing is decided. A store holding the
    /// account is adopted at once. An empty one is believed only once the
    /// initial-sync notice has arrived in this launch, or `uploadGrace`
    /// seconds after a successful synchronize.
    static func joinDecision(
        storeHasAccountKeys: Bool,
        initialSyncArrived: Bool,
        secondsSinceSuccessfulSync: TimeInterval?,
        hasICloudIdentity: Bool
    ) -> JoinDecision {
        guard hasICloudIdentity else { return .wait(recheckIn: nil) }
        if storeHasAccountKeys { return .adopt }
        if initialSyncArrived { return .upload }
        guard let elapsed = secondsSinceSuccessfulSync else { return .wait(recheckIn: nil) }
        return elapsed >= uploadGrace ? .upload : .wait(recheckIn: uploadGrace - elapsed)
    }

    /// Taking iCloud's settings: each synced setting iCloud holds is set
    /// where it differs, and each synced setting iCloud lacks is removed, so
    /// the page shows its default. Device-type settings are never touched
    /// here; `deviceTypeAdoption` decides those, separately.
    struct Adoption {
        var set: [String: Any]
        var remove: [String]
    }

    static func adoption(local: [String: Any], inStore: [String: Any]) -> Adoption {
        var set: [String: Any] = [:]
        for (key, item) in inStore where isSyncedKey(key) {
            guard let value = settingValue(item), !sameValue(local[key], item) else { continue }
            set[key] = plain(value)
        }
        let remove = local.keys.filter { isSyncedKey($0) && inStore[$0] == nil }.sorted()
        return Adoption(set: set, remove: remove)
    }

    /// The same decision as `adoption(local:inStore:)`, for one account's
    /// device-type bucket. `local` and `inStore` are already scoped to
    /// `deviceTypeKeys` by the caller, so this does not call `isSyncedKey`.
    static func deviceTypeAdoption(local: [String: Any], inStore: [String: Any]) -> Adoption {
        var set: [String: Any] = [:]
        for (key, item) in inStore where deviceTypeKeys.contains(key) {
            guard let value = settingValue(item), !sameValue(local[key], item) else { continue }
            set[key] = plain(value)
        }
        let remove = local.keys.filter { deviceTypeKeys.contains($0) && inStore[$0] == nil }.sorted()
        return Adoption(set: set, remove: remove)
    }

    // MARK: The Safari extension

    /// What the extension's native part does with one message from its
    /// background script: the reply, and the one store write a `set` asks
    /// for. Decided here, away from the store, so the package tests it.
    struct ExtensionAnswer {
        var reply: [String: Any]
        var write: (key: String, value: Any)?
    }

    /// - `get {accountId}` replies `{ok, available, settings}`: the account's
    ///   synced settings without the prefix, merged with this Mac's bucket of
    ///   the device-type settings (Safari's device type is always `.mac`),
    ///   and whether this Mac has an iCloud account.
    /// - `set {accountId, key, value}` replies `{ok}` and writes one key: a
    ///   device-type key goes to this Mac's bucket, everything else to the
    ///   plain, per-account key.
    /// - An unknown action, or a bad id, key or value, replies
    ///   `{ok: false, error}` and writes nothing.
    static func extensionAnswer(
        to message: [String: Any],
        hasICloudIdentity: Bool,
        storeContents: () -> [String: Any]
    ) -> ExtensionAnswer {
        guard let accountId = message["accountId"] as? String, isValidAccountId(accountId) else {
            return refusal("the message has no usable accountId")
        }
        let action = message["action"] as? String ?? ""
        switch action {
        case "get":
            let contents = storeContents()
            var settings = settings(for: accountId, in: contents)
            for (key, value) in deviceTypeSettings(for: accountId, deviceType: .mac, in: contents) {
                settings[key] = value
            }
            return ExtensionAnswer(
                reply: ["ok": true, "available": hasICloudIdentity, "settings": settings],
                write: nil
            )
        case "set":
            guard let key = message["key"] as? String else {
                return refusal("the message has no usable key")
            }
            let entryKey = deviceTypeKeys.contains(key)
                ? deviceTypeStoreKey(accountId: accountId, deviceType: .mac, key: key)
                : storeKey(accountId: accountId, key: key)
            guard let entryKey else {
                return refusal("the message has no usable key")
            }
            guard let item = message["value"], let value = settingValue(item) else {
                return refusal("the value must be a boolean or a string")
            }
            return ExtensionAnswer(reply: ["ok": true], write: (key: entryKey, value: plain(value)))
        default:
            return refusal("unknown action")
        }
    }

    private static func refusal(_ error: String) -> ExtensionAnswer {
        ExtensionAnswer(reply: ["ok": false, "error": error], write: nil)
    }

    // MARK: Characters

    /// ASCII only, by code point, so the answer is the same for every
    /// compiler and every macOS the extension may run on.
    private static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 65...90, 97...122: return true
        default: return false
        }
    }

    private static func isDigit(_ scalar: Unicode.Scalar) -> Bool {
        (48...57).contains(scalar.value)
    }
}
