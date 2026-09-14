import Foundation
import Testing
@testable import FastmailShellKit

/// iCloud's store, faked: it answers from a dictionary and records every
/// write made through it.
private final class FakeStore: KeyValueStore {
    var values: [String: Any] = [:]
    var writes: [String] = []
    var synchronizeAnswer = true
    var synchronizeCount = 0

    func object(forKey key: String) -> Any? { values[key] }

    func set(_ value: Any?, forKey key: String) {
        writes.append(key)
        values[key] = value
    }

    var dictionaryRepresentation: [String: Any] { values }

    func synchronize() -> Bool {
        synchronizeCount += 1
        return synchronizeAnswer
    }
}

/// One sync component with everything it touches in reach: throwaway
/// defaults, the fake store, a clock that moves only when told and a
/// scheduler that runs only when told, so no test waits.
@MainActor
private final class Harness {
    let defaults: UserDefaults
    let store = FakeStore()
    var hasICloudIdentity = true
    var now = Date(timeIntervalSinceReferenceDate: 1_000_000)
    var deviceType: SettingsSyncRules.DeviceType = .mac
    var scheduled: [(delay: TimeInterval, work: @MainActor @Sendable () -> Void)] = []
    private(set) var sync: CustomModeSettingsSync!

    init(_ name: String, deviceType: SettingsSyncRules.DeviceType = .mac) {
        let suite = "CustomModeSettingsSyncTests.\(name)"
        defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        self.deviceType = deviceType
        sync = CustomModeSettingsSync(
            defaults: defaults,
            store: store,
            hasICloudIdentity: { [unowned self] in self.hasICloudIdentity },
            now: { [unowned self] in self.now },
            schedule: { [unowned self] delay, work in self.scheduled.append((delay, work)) },
            deviceType: { [unowned self] in self.deviceType }
        )
    }

    func advance(_ seconds: TimeInterval) {
        now = now.addingTimeInterval(seconds)
    }

    /// Runs whatever is waiting, as the timer would once its time came.
    func runScheduled() {
        let due = scheduled
        scheduled = []
        for entry in due {
            entry.work()
        }
    }

    func local(_ key: String) -> Any? {
        defaults.object(forKey: CustomModeSettings.defaultsKey(for: key))
    }
}

// MARK: Joining

@Test @MainActor func joiningAdoptsTheStoresSettingsAndRemovesSyncedOnesItLacks() {
    let h = Harness(#function)
    h.defaults.set(true, forKey: "customMode.labelColours")
    h.defaults.set("x", forKey: "customMode.snoozeKey")
    h.defaults.set("4", forKey: "customMode.bottomBarItems")
    h.store.values = ["u1234abcd.labelColours": NSNumber(value: false), "u1234abcd.triageLabel": "Todo"]

    h.sync.accountReported("u1234abcd")

    #expect(h.local("labelColours") as? Bool == false)
    #expect(h.local("triageLabel") as? String == "Todo")
    #expect(h.local("snoozeKey") == nil)
    // The bar length is this device's own
    #expect(h.local("bottomBarItems") as? String == "4")
    #expect(h.sync.isJoined("u1234abcd"))
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func anEmptyStoreIsUploadedAfterTheInitialSyncNoticeAndNotBefore() {
    let h = Harness(#function)
    h.defaults.set(false, forKey: "customMode.labelColours")
    h.defaults.set("Todo", forKey: "customMode.triageLabel")
    h.defaults.set("4", forKey: "customMode.bottomBarItems")

    h.sync.accountReported("u1234abcd")
    #expect(h.store.writes.isEmpty)
    #expect(!h.sync.isJoined("u1234abcd"))

    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreInitialSyncChange, keys: [])

    #expect(h.store.values["u1234abcd.labelColours"] as? Bool == false)
    #expect(h.store.values["u1234abcd.triageLabel"] as? String == "Todo")
    #expect(h.store.values["u1234abcd.bottomBarItems"] == nil)
    #expect(h.sync.isJoined("u1234abcd"))
}

@Test @MainActor func anEmptyStoreIsUploadedThirtySecondsAfterASuccessfulSynchronizeAndNotBefore() {
    let h = Harness(#function)
    h.defaults.set("Todo", forKey: "customMode.triageLabel")

    h.sync.accountReported("u1234abcd")
    #expect(h.scheduled.map { $0.delay } == [30])

    // Run early, the look finds ten seconds gone and waits the other twenty
    h.advance(10)
    h.runScheduled()
    #expect(h.store.writes.isEmpty)
    #expect(!h.sync.isJoined("u1234abcd"))
    #expect(h.scheduled.map { $0.delay } == [20])

    h.advance(20)
    h.runScheduled()
    #expect(h.store.values["u1234abcd.triageLabel"] as? String == "Todo")
    #expect(h.sync.isJoined("u1234abcd"))
}

// A second report while a look is already due schedules no second look
@Test @MainActor func oneRecheckIsScheduledAtATime() {
    let h = Harness(#function)
    h.sync.accountReported("u1234abcd")
    h.advance(5)
    h.sync.accountReported("u1234abcd")
    #expect(h.scheduled.count == 1)
}

// Nothing has been heard from iCloud, so there is no clock to run out
@Test @MainActor func aFailedSynchronizeStartsNoClock() {
    let h = Harness(#function)
    h.store.synchronizeAnswer = false
    h.sync.accountReported("u1234abcd")
    h.advance(60)
    h.sync.accountReported("u1234abcd")
    #expect(h.scheduled.isEmpty)
    #expect(h.store.writes.isEmpty)
    #expect(!h.sync.isJoined("u1234abcd"))
}

@Test @MainActor func withoutAnICloudAccountTheAppStaysUnjoined() {
    let h = Harness(#function)
    h.hasICloudIdentity = false
    h.defaults.set("Mine", forKey: "customMode.triageLabel")
    h.store.values = ["u1234abcd.triageLabel": "Todo"]

    h.sync.accountReported("u1234abcd")

    #expect(h.local("triageLabel") as? String == "Mine")
    #expect(!h.sync.isJoined("u1234abcd"))
    #expect(h.scheduled.isEmpty)
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func launchJoinsTheLastReportedAccountBeforeAnyPage() {
    let h = Harness(#function)
    h.defaults.set("u1234abcd", forKey: "settingsSync.accountId")
    h.store.values = ["u1234abcd.triageLabel": "Todo"]

    h.sync.start()

    #expect(h.local("triageLabel") as? String == "Todo")
    #expect(h.sync.isJoined("u1234abcd"))
}

// MARK: The bar bucket

@Test @MainActor func joiningAdoptsAnExistingMacBucketValue() {
    let h = Harness(#function)
    h.defaults.set("4", forKey: "customMode.bottomBarItems")
    h.store.values = ["u1234abcd.bar.mac.bottomBarItems": "6"]

    h.sync.accountReported("u1234abcd")

    #expect(h.local("bottomBarItems") as? String == "6")
    #expect(h.sync.isJoinedBar("u1234abcd"))
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func anEmptyBucketIsUploadedAfterTheInitialSyncNoticeOrThirtySeconds() {
    let h = Harness(#function)
    h.defaults.set("4", forKey: "customMode.bottomBarItems")
    // The account's plain settings are already there, so only the bar bucket
    // is left to decide
    h.store.values = ["u1234abcd.triageLabel": "Todo"]

    h.sync.accountReported("u1234abcd")
    #expect(h.sync.isJoined("u1234abcd"))
    #expect(!h.sync.isJoinedBar("u1234abcd"))
    #expect(h.store.values["u1234abcd.bar.mac.bottomBarItems"] == nil)

    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreInitialSyncChange, keys: [])

    #expect(h.store.values["u1234abcd.bar.mac.bottomBarItems"] as? String == "4")
    #expect(h.sync.isJoinedBar("u1234abcd"))
}

@Test @MainActor func aLocalBarChangeWritesTheDeviceTypeKeyOnceJoinedAndNotBefore() {
    let unjoined = Harness(#function + ".unjoined")
    unjoined.sync.accountReported("u1234abcd")
    unjoined.sync.localChanged(key: "bottomBarItems", value: "4")
    #expect(unjoined.store.writes.isEmpty)

    let joined = Harness(#function + ".joined")
    joined.store.values = ["u1234abcd.bar.mac.bottomBarItems": "6"]
    joined.sync.accountReported("u1234abcd")

    joined.sync.localChanged(key: "bottomBarItems", value: "8")

    #expect(joined.store.writes == ["u1234abcd.bar.mac.bottomBarItems"])
    #expect(joined.store.values["u1234abcd.bar.mac.bottomBarItems"] as? String == "8")
}

@Test @MainActor func anExternalBarChangeFromTheSameDeviceTypeIsTaken() {
    let h = Harness(#function, deviceType: .iphone)
    h.store.values = ["u1234abcd.bar.iphone.bottomBarItems": "4"]
    h.sync.accountReported("u1234abcd")

    h.store.values["u1234abcd.bar.iphone.bottomBarItems"] = "2"
    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreServerChange, keys: ["u1234abcd.bar.iphone.bottomBarItems"])

    #expect(h.local("bottomBarItems") as? String == "2")
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func anExternalBarChangeFromADifferentDeviceTypeOrAccountIsIgnored() {
    let h = Harness(#function, deviceType: .mac)
    h.defaults.set("4", forKey: "customMode.bottomBarItems")
    h.store.values = ["u1234abcd.bar.mac.bottomBarItems": "4"]
    h.sync.accountReported("u1234abcd")

    h.store.values["u1234abcd.bar.ipad.bottomBarItems"] = "9"
    h.store.values["u9999zzzz.bar.mac.bottomBarItems"] = "7"
    h.sync.externalChange(
        reason: NSUbiquitousKeyValueStoreServerChange,
        keys: ["u1234abcd.bar.ipad.bottomBarItems", "u9999zzzz.bar.mac.bottomBarItems"]
    )

    #expect(h.local("bottomBarItems") as? String == "4")
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func turningSyncOffClearsTheBarJoinedFlagAndStopsBarWritesToo() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.bar.mac.bottomBarItems": "4"]
    h.sync.accountReported("u1234abcd")
    #expect(h.sync.isJoinedBar("u1234abcd"))

    h.sync.setEnabled(false)

    #expect(!h.sync.isJoinedBar("u1234abcd"))
    h.sync.localChanged(key: "bottomBarItems", value: "8")
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func turningSyncOnAndOffReAdoptsTheBarBucketSameAsThePlainOne() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.bar.mac.bottomBarItems": "4"]
    h.sync.accountReported("u1234abcd")
    h.sync.setEnabled(false)
    h.defaults.set("Changed while off", forKey: "customMode.bottomBarItems")

    h.sync.setEnabled(true)

    #expect(h.local("bottomBarItems") as? String == "4")
    #expect(h.sync.isJoinedBar("u1234abcd"))
}

// MARK: Local changes

@Test @MainActor func aLocalChangeWritesThePrefixedKeyOnceJoined() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")

    h.sync.localChanged(key: "labelColours", value: false)

    #expect(h.store.writes == ["u1234abcd.labelColours"])
    #expect(h.store.values["u1234abcd.labelColours"] as? Bool == false)
}

@Test @MainActor func aLocalChangeWritesNothingForABarLengthBeforeJoiningOrWithoutAnAccount() {
    let noAccount = Harness(#function + ".noAccount")
    noAccount.sync.localChanged(key: "labelColours", value: false)
    #expect(noAccount.store.writes.isEmpty)

    // An empty store and no initial sync yet: the account waits to join
    let unjoined = Harness(#function + ".unjoined")
    unjoined.sync.accountReported("u1234abcd")
    unjoined.sync.localChanged(key: "labelColours", value: false)
    #expect(unjoined.store.writes.isEmpty)

    let joined = Harness(#function + ".joined")
    joined.store.values = ["u1234abcd.triageLabel": "Todo"]
    joined.sync.accountReported("u1234abcd")
    joined.sync.localChanged(key: "bottomBarItems", value: "4")
    joined.sync.localChanged(key: "topBarItems", value: "6")
    joined.sync.localChanged(key: "labelColours", value: NSNumber(value: 1))
    #expect(joined.store.writes.isEmpty)
}

// MARK: Changes from other devices

@Test @MainActor func anExternalChangeTakesOnlyThisAccountsSyncedKeysAndWritesNothingBack() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.defaults.set("4", forKey: "customMode.bottomBarItems")
    h.defaults.set("w", forKey: "customMode.snoozeKey")

    h.store.values["u1234abcd.triageLabel"] = "Later"
    h.store.values["u1234abcd.bottomBarItems"] = "2"
    h.store.values["u9999zzzz.snoozeKey"] = "q"
    h.sync.externalChange(
        reason: NSUbiquitousKeyValueStoreServerChange,
        keys: ["u1234abcd.triageLabel", "u1234abcd.bottomBarItems", "u9999zzzz.snoozeKey"]
    )

    #expect(h.local("triageLabel") as? String == "Later")
    #expect(h.local("bottomBarItems") as? String == "4")
    #expect(h.local("snoozeKey") as? String == "w")
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func overQuotaTheSettingsAreLeftAlone() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")

    h.store.values["u1234abcd.triageLabel"] = "Later"
    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreQuotaViolationChange, keys: ["u1234abcd.triageLabel"])

    #expect(h.local("triageLabel") as? String == "Todo")
}

// MARK: Account changes

@Test @MainActor func anICloudAccountChangeClearsEveryJoinedFlagAndJoinsAgain() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.defaults.set(true, forKey: "settingsSync.joined.u5555")

    h.store.values = ["u1234abcd.triageLabel": "Elsewhere"]
    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreAccountChange, keys: [])

    #expect(h.defaults.object(forKey: "settingsSync.joined.u5555") == nil)
    #expect(h.local("triageLabel") as? String == "Elsewhere")
    #expect(h.sync.isJoined("u1234abcd"))
}

@Test @MainActor func aPageOnAnotherAccountSwitchesToItsKeysAndJoinsIt() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo", "u5678efgh.triageLabel": "Work"]
    h.sync.accountReported("u1234abcd")

    h.sync.accountReported("u5678efgh")
    h.sync.localChanged(key: "snoozeKey", value: "q")

    #expect(h.defaults.string(forKey: "settingsSync.accountId") == "u5678efgh")
    #expect(h.local("triageLabel") as? String == "Work")
    #expect(h.sync.isJoined("u5678efgh"))
    #expect(h.store.writes == ["u5678efgh.snoozeKey"])
}

@Test @MainActor func aBadlyFormedAccountIsIgnored() {
    let h = Harness(#function)
    h.sync.accountReported("u1234.abcd")
    #expect(h.defaults.object(forKey: "settingsSync.accountId") == nil)
    #expect(h.store.synchronizeCount == 0)
}

// MARK: The switch

@Test @MainActor func theSwitchIsOnByDefault() {
    let h = Harness(#function)
    #expect(h.sync.isEnabled)
    #expect(CustomModeSettingsSync.isEnabled(in: h.defaults))
}

@Test @MainActor func turningSyncOffStopsEveryReadAndWriteAndClearsTheJoinedFlags() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.defaults.set(true, forKey: "settingsSync.joined.u5555")

    h.sync.setEnabled(false)

    #expect(!h.sync.isEnabled)
    #expect(!h.sync.isJoined("u1234abcd"))
    #expect(h.defaults.object(forKey: "settingsSync.joined.u5555") == nil)

    let synchronized = h.store.synchronizeCount
    h.sync.localChanged(key: "labelColours", value: false)
    h.store.values["u1234abcd.snoozeKey"] = "q"
    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreServerChange, keys: ["u1234abcd.snoozeKey"])
    h.sync.accountReported("u1234abcd")
    h.sync.start()

    #expect(h.store.writes.isEmpty)
    #expect(h.store.synchronizeCount == synchronized)
    #expect(h.local("snoozeKey") == nil)
    // Every setting keeps its value
    #expect(h.local("triageLabel") as? String == "Todo")
}

@Test @MainActor func turningSyncOnJoinsAgainAndICloudWins() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.sync.setEnabled(false)
    h.defaults.set("Changed while off", forKey: "customMode.triageLabel")

    h.sync.setEnabled(true)

    #expect(h.local("triageLabel") as? String == "Todo")
    #expect(h.sync.isJoined("u1234abcd"))
}

// The switch and the account sit beside the settings, never among them:
// the page is not handed them as settings, and they never become store keys
@Test @MainActor func theSyncStateIsNeverASetting() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.sync.setEnabled(false)
    h.sync.setEnabled(true)

    let settings = CustomModeSettings.current(from: h.defaults)
    #expect(!settings.keys.contains { $0.contains("enabled") || $0.contains("accountId") || $0.contains("joined") })
    #expect(SettingsSyncRules.storeKey(accountId: "u1234abcd", key: CustomModeSettingsSync.enabledKey) == nil)
    h.sync.localChanged(key: CustomModeSettingsSync.enabledKey, value: false)
    #expect(h.store.writes.isEmpty)
}

// The notice carries its reason as a plain integer
@Test @MainActor func theChangeReasonsAreFoundationsOwnNumbers() {
    #expect(CustomModeSettingsSync.ChangeReason.serverChange.rawValue == NSUbiquitousKeyValueStoreServerChange)
    #expect(CustomModeSettingsSync.ChangeReason.initialSync.rawValue == NSUbiquitousKeyValueStoreInitialSyncChange)
    #expect(CustomModeSettingsSync.ChangeReason.quotaViolation.rawValue == NSUbiquitousKeyValueStoreQuotaViolationChange)
    #expect(CustomModeSettingsSync.ChangeReason.accountChange.rawValue == NSUbiquitousKeyValueStoreAccountChange)
}
