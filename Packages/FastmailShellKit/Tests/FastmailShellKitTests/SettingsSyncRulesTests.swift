import Foundation
import Testing
@testable import FastmailShellKit

// MARK: Keys

@Test func aStoreKeyIsTheAccountADotAndTheSetting() {
    #expect(SettingsSyncRules.storeKey(accountId: "u1234abcd", key: "labelColours") == "u1234abcd.labelColours")
    let parsed = SettingsSyncRules.parse(storeKey: "u1234abcd.labelColours")
    #expect(parsed?.accountId == "u1234abcd")
    #expect(parsed?.key == "labelColours")
}

@Test func accountIdsAreOneToThirtyTwoLettersDigitsHyphensAndUnderscores() {
    for good in ["u1234abcd", "a", "A-b_9", String(repeating: "x", count: 32)] {
        #expect(SettingsSyncRules.isValidAccountId(good), "\(good) should be accepted")
    }
    for bad in ["", String(repeating: "x", count: 33), "u1234.abcd", "u1234 abcd", "ü1234", "u1234/abcd", "u1234abcd\n"] {
        #expect(!SettingsSyncRules.isValidAccountId(bad), "\(bad.debugDescription) should be refused")
    }
}

// The rules file cannot see CustomModeSettings, so it carries the rule
// again; the two must never part.
@Test func theSettingKeyRuleIsCustomModeSettingsOwn() {
    let samples = [
        "labelColours", "a", "Z9", "abc123", "", "1st", "has space", "has-hyphen",
        "has_underscore", "push.alerts", "customMode.triageLabel", "é", "café",
        "e\u{301}", "\r\n", "a\r\n", "Ⅻ", "٣", "abc٣", "ｆｕｌｌ", "a\u{0}",
    ]
    for key in samples {
        #expect(
            SettingsSyncRules.isSettingKey(key) == CustomModeSettings.isWritableSettingKey(key),
            "\(key.debugDescription)"
        )
    }
}

// The bar lengths depend on the screen, so they never travel as plain,
// per-account store keys; they travel through the device-type key space
// instead (see the "Device type" tests below).
@Test func theBarLengthsAreNeverPlainStoreKeys() {
    #expect(SettingsSyncRules.deviceTypeKeys == ["bottomBarItems", "topBarItems"])
    #expect(SettingsSyncRules.storeKey(accountId: "u1234abcd", key: "bottomBarItems") == nil)
    #expect(SettingsSyncRules.storeKey(accountId: "u1234abcd", key: "topBarItems") == nil)
    #expect(SettingsSyncRules.parse(storeKey: "u1234abcd.topBarItems") == nil)
}

@Test func keysThatAreNotSyncedSettingsAreNotParsed() {
    for key in ["nodot", ".labelColours", "u1234abcd.", "u1234abcd.bad.key", "u12 34.labelColours", "u1234abcd.1st"] {
        #expect(SettingsSyncRules.parse(storeKey: key) == nil, "\(key) should not parse")
    }
}

// iCloud refuses a key longer than 64 bytes
@Test func aStoreKeyStaysWithinSixtyFourBytes() {
    let account = String(repeating: "a", count: 32)
    let longest = SettingsSyncRules.storeKey(accountId: account, key: "k" + String(repeating: "x", count: 30))
    #expect(longest?.utf8.count == 64)
    #expect(SettingsSyncRules.storeKey(accountId: account, key: "k" + String(repeating: "x", count: 31)) == nil)
    #expect(SettingsSyncRules.storeKey(accountId: account, key: "labelColoursSkipTriage") != nil)
}

// MARK: Values

@Test func onlyRealBooleansAndStringsAreSettingValues() {
    #expect(SettingsSyncRules.isSyncableValue(true))
    #expect(SettingsSyncRules.isSyncableValue("Todo"))
    #expect(!SettingsSyncRules.isSyncableValue(NSNumber(value: 1)))
    #expect(!SettingsSyncRules.isSyncableValue(2.5))
    #expect(!SettingsSyncRules.isSyncableValue(["a"]))
    #expect(SettingsSyncRules.sameValue(false, NSNumber(value: false)))
    #expect(!SettingsSyncRules.sameValue(true, NSNumber(value: 1)))
    #expect(!SettingsSyncRules.sameValue("true", true))
    #expect(!SettingsSyncRules.sameValue(nil, "Todo"))
}

@Test func anAccountsSettingsAreTakenFromTheStoreWithoutThePrefix() {
    let contents: [String: Any] = [
        "u1234abcd.labelColours": NSNumber(value: false),
        "u1234abcd.triageLabel": "Todo",
        "u1234abcd.topBarItems": "3",
        "u1234abcd.snoozeDefault": NSNumber(value: 4),
        "u9999zzzz.triageLabel": "Other",
        "unrelated": "x",
    ]
    let settings = SettingsSyncRules.settings(for: "u1234abcd", in: contents)
    #expect(Set(settings.keys) == ["labelColours", "triageLabel"])
    #expect(settings["labelColours"] as? Bool == false)
    #expect(settings["triageLabel"] as? String == "Todo")
}

@Test func uploadingSendsTheSyncedSettingsUnderTheirPrefixedKeys() {
    let local: [String: Any] = [
        "labelColours": true, "triageLabel": "Todo", "bottomBarItems": "4", "snoozeDefault": NSNumber(value: 3),
    ]
    let entries = SettingsSyncRules.storeEntries(accountId: "u1234abcd", local: local)
    #expect(Set(entries.keys) == ["u1234abcd.labelColours", "u1234abcd.triageLabel"])
    #expect(entries["u1234abcd.labelColours"] as? Bool == true)
}

// MARK: Joining

@Test func joiningAdoptsWhateverTheStoreHoldsForTheAccount() {
    let decision = SettingsSyncRules.joinDecision(
        storeHasAccountKeys: true, initialSyncArrived: false,
        secondsSinceSuccessfulSync: nil, hasICloudIdentity: true
    )
    #expect(decision == .adopt)
}

@Test func anEmptyStoreIsBelievedAfterTheInitialSyncOrThirtySeconds() {
    func decide(initialSync: Bool, seconds: TimeInterval?) -> SettingsSyncRules.JoinDecision {
        SettingsSyncRules.joinDecision(
            storeHasAccountKeys: false, initialSyncArrived: initialSync,
            secondsSinceSuccessfulSync: seconds, hasICloudIdentity: true
        )
    }
    #expect(decide(initialSync: true, seconds: nil) == .upload)
    #expect(decide(initialSync: false, seconds: 30) == .upload)
    #expect(decide(initialSync: false, seconds: 12) == .wait(recheckIn: 18))
    #expect(decide(initialSync: false, seconds: nil) == .wait(recheckIn: nil))
}

@Test func withoutAnICloudAccountNothingIsDecided() {
    let decision = SettingsSyncRules.joinDecision(
        storeHasAccountKeys: true, initialSyncArrived: true,
        secondsSinceSuccessfulSync: 60, hasICloudIdentity: false
    )
    #expect(decision == .wait(recheckIn: nil))
}

@Test func adoptingSetsWhatDiffersAndRemovesSyncedSettingsTheStoreLacks() {
    let local: [String: Any] = ["labelColours": true, "triageLabel": "Todo", "snoozeKey": "w", "bottomBarItems": "4"]
    let inStore: [String: Any] = ["labelColours": false, "triageLabel": "Todo", "urgentKey": "p"]
    let plan = SettingsSyncRules.adoption(local: local, inStore: inStore)
    #expect(Set(plan.set.keys) == ["labelColours", "urgentKey"])
    #expect(plan.set["labelColours"] as? Bool == false)
    #expect(plan.remove == ["snoozeKey"])
}

// MARK: Device type

@Test func aDeviceTypeStoreKeyIsTheAccountBarTheDeviceTypeAndTheKey() {
    #expect(
        SettingsSyncRules.deviceTypeStoreKey(accountId: "u1234abcd", deviceType: .mac, key: "bottomBarItems")
            == "u1234abcd.bar.mac.bottomBarItems"
    )
    let parsed = SettingsSyncRules.parseDeviceTypeKey(storeKey: "u1234abcd.bar.mac.bottomBarItems")
    #expect(parsed?.accountId == "u1234abcd")
    #expect(parsed?.deviceType == .mac)
    #expect(parsed?.key == "bottomBarItems")
}

@Test func deviceTypeStoreKeyRefusesABadAccountIdOrAKeyNotInDeviceTypeKeys() {
    #expect(SettingsSyncRules.deviceTypeStoreKey(accountId: "u1234.abcd", deviceType: .mac, key: "bottomBarItems") == nil)
    #expect(SettingsSyncRules.deviceTypeStoreKey(accountId: "u1234abcd", deviceType: .mac, key: "labelColours") == nil)
    // Even the longest account id and device type name stays within the
    // 64-byte limit: 32 + ".bar.iphone.bottomBarItems" (26 bytes) = 58
    let account = String(repeating: "a", count: 32)
    let longest = SettingsSyncRules.deviceTypeStoreKey(accountId: account, deviceType: .iphone, key: "bottomBarItems")
    #expect(longest?.utf8.count == 58)
}

@Test func parseDeviceTypeKeyRefusesAPlainKeyAnUnknownDeviceTypeOrAKeyNotInDeviceTypeKeys() {
    // A plain key has only one dot; a device-type key needs exactly three
    #expect(SettingsSyncRules.parseDeviceTypeKey(storeKey: "u1234abcd.labelColours") == nil)
    #expect(SettingsSyncRules.parseDeviceTypeKey(storeKey: "u1234abcd.bar.android.bottomBarItems") == nil)
    #expect(SettingsSyncRules.parseDeviceTypeKey(storeKey: "u1234abcd.bar.mac.labelColours") == nil)
    #expect(SettingsSyncRules.parseDeviceTypeKey(storeKey: "u1234abcd.notbar.mac.bottomBarItems") == nil)
}

@Test func deviceTypeSettingsExtractsOnlyTheMatchingAccountsAndDeviceTypesBarKeys() {
    let contents: [String: Any] = [
        "u1234abcd.bar.mac.bottomBarItems": "3",
        "u1234abcd.bar.iphone.bottomBarItems": "2",
        "u1234abcd.bar.mac.topBarItems": "1",
        "u9999zzzz.bar.mac.bottomBarItems": "5",
        "u1234abcd.triageLabel": "Todo",
    ]
    let settings = SettingsSyncRules.deviceTypeSettings(for: "u1234abcd", deviceType: .mac, in: contents)
    #expect(Set(settings.keys) == ["bottomBarItems", "topBarItems"])
    #expect(settings["bottomBarItems"] as? String == "3")
}

@Test func deviceTypeStoreEntriesProducesOnlyPrefixedBarKeysFromALocalDictThatAlsoHasPlainSettings() {
    let local: [String: Any] = ["bottomBarItems": "4", "topBarItems": "2", "labelColours": true, "triageLabel": "Todo"]
    let entries = SettingsSyncRules.deviceTypeStoreEntries(accountId: "u1234abcd", deviceType: .ipad, local: local)
    #expect(Set(entries.keys) == ["u1234abcd.bar.ipad.bottomBarItems", "u1234abcd.bar.ipad.topBarItems"])
    #expect(entries["u1234abcd.bar.ipad.bottomBarItems"] as? String == "4")
}

@Test func deviceTypeAdoptionSetsWhatDiffersAndRemovesBarKeysTheStoreLacks() {
    let local: [String: Any] = ["bottomBarItems": "4", "topBarItems": "2"]
    let inStore: [String: Any] = ["bottomBarItems": "6"]
    let plan = SettingsSyncRules.deviceTypeAdoption(local: local, inStore: inStore)
    #expect(Set(plan.set.keys) == ["bottomBarItems"])
    #expect(plan.set["bottomBarItems"] as? String == "6")
    #expect(plan.remove == ["topBarItems"])
}

// MARK: The Safari extension's native part

@Test func theExtensionsGetAnswersOneAccountsSyncedSettingsWithoutThePrefix() throws {
    let contents: [String: Any] = [
        "u1234abcd.triageLabel": "Todo",
        "u1234abcd.labelColours": NSNumber(value: false),
        "u9999zzzz.triageLabel": "Other",
    ]
    let answer = SettingsSyncRules.extensionAnswer(
        to: ["action": "get", "accountId": "u1234abcd"],
        hasICloudIdentity: true,
        storeContents: { contents }
    )
    #expect(answer.write == nil)
    #expect(answer.reply["ok"] as? Bool == true)
    #expect(answer.reply["available"] as? Bool == true)
    let settings = try #require(answer.reply["settings"] as? [String: Any])
    #expect(Set(settings.keys) == ["triageLabel", "labelColours"])
}

// The get reply merges the plain settings with this Mac's own bucket of the
// device-type (bar) settings, since Safari's device type is always .mac
@Test func theExtensionsGetMergesPlainSettingsWithTheMacBucketOfBarSettings() throws {
    let contents: [String: Any] = [
        "u1234abcd.triageLabel": "Todo",
        "u1234abcd.bar.mac.bottomBarItems": "3",
        "u1234abcd.bar.mac.topBarItems": "5",
        "u1234abcd.bar.iphone.bottomBarItems": "2",
        "u9999zzzz.bar.mac.bottomBarItems": "9",
    ]
    let answer = SettingsSyncRules.extensionAnswer(
        to: ["action": "get", "accountId": "u1234abcd"],
        hasICloudIdentity: true,
        storeContents: { contents }
    )
    let settings = try #require(answer.reply["settings"] as? [String: Any])
    #expect(Set(settings.keys) == ["triageLabel", "bottomBarItems", "topBarItems"])
    #expect(settings["bottomBarItems"] as? String == "3")
    #expect(settings["topBarItems"] as? String == "5")
}

@Test func theExtensionsGetSaysWhenThereIsNoICloudAccount() {
    let answer = SettingsSyncRules.extensionAnswer(
        to: ["action": "get", "accountId": "u1234abcd"],
        hasICloudIdentity: false,
        storeContents: { [:] }
    )
    #expect(answer.reply["ok"] as? Bool == true)
    #expect(answer.reply["available"] as? Bool == false)
}

@Test func theExtensionsSetWritesOnePrefixedKeyWithoutReadingTheStore() {
    var read = 0
    let answer = SettingsSyncRules.extensionAnswer(
        to: ["action": "set", "accountId": "u1234abcd", "key": "labelColours", "value": false],
        hasICloudIdentity: true,
        storeContents: {
            read += 1
            return [:]
        }
    )
    #expect(answer.reply["ok"] as? Bool == true)
    #expect(answer.write?.key == "u1234abcd.labelColours")
    #expect(answer.write?.value as? Bool == false)
    #expect(read == 0)
}

// A bar item now succeeds, writing the mac-bucket key rather than the plain
// account key (which does not exist for these two settings)
@Test func theExtensionsSetOnABarItemSucceedsAndWritesTheMacBucketKey() {
    let answer = SettingsSyncRules.extensionAnswer(
        to: ["action": "set", "accountId": "u1234abcd", "key": "bottomBarItems", "value": "4"],
        hasICloudIdentity: true,
        storeContents: { [:] }
    )
    #expect(answer.reply["ok"] as? Bool == true)
    #expect(answer.write?.key == "u1234abcd.bar.mac.bottomBarItems")
    #expect(answer.write?.value as? String == "4")
}

@Test func theExtensionRefusesBadIdsKeysValuesAndActions() {
    let messages: [[String: Any]] = [
        ["action": "set", "accountId": "", "key": "labelColours", "value": true],
        ["action": "set", "accountId": String(repeating: "a", count: 33), "key": "labelColours", "value": true],
        ["action": "set", "accountId": "u1234abcd", "key": "bad.key", "value": true],
        ["action": "set", "accountId": "u1234abcd", "key": "labelColours", "value": NSNumber(value: 1)],
        ["action": "set", "accountId": "u1234abcd", "key": "labelColours"],
        ["action": "get"],
        ["action": "delete", "accountId": "u1234abcd"],
    ]
    for message in messages {
        let answer = SettingsSyncRules.extensionAnswer(to: message, hasICloudIdentity: true, storeContents: { [:] })
        #expect(answer.reply["ok"] as? Bool == false, "\(message)")
        #expect(answer.reply["error"] is String)
        #expect(answer.write == nil)
    }
}
