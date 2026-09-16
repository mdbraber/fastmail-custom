import Foundation
import Testing
@testable import FastmailShellKit

// Applying settings makes the page drop its caches and ask the server for
// counts again, so a defaults write that changed nothing the page reads, such
// as the page the app is on, must not reach it.
@Test func settingsThePageAlreadyHasAreNotPushedAgain() {
    #expect(!FastmailCustomSettingsPusher.shouldPush(#"{"a":true}"#, after: #"{"a":true}"#, force: false))
}

@Test func changedSettingsArePushed() {
    #expect(FastmailCustomSettingsPusher.shouldPush(#"{"a":false}"#, after: #"{"a":true}"#, force: false))
}

// A page that has only what it started with gets the next push, as it always did.
@Test func aPageThatWasNeverPushedToGetsTheNextPush() {
    #expect(FastmailCustomSettingsPusher.shouldPush(#"{"a":true}"#, after: nil, force: false))
}

// Coming back to the front pushes regardless, as it always did.
@Test func aForcedPushAlwaysGoes() {
    #expect(FastmailCustomSettingsPusher.shouldPush(#"{"a":true}"#, after: #"{"a":true}"#, force: true))
}

@Test func savingThePageLeavesTheFastmailCustomSettingsAsTheyWere() {
    let suite = "pusher-last-page-test"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    defaults.set(true, forKey: FastmailCustomSettings.defaultsKey(for: "filteredLabelCounts"))
    let before = FastmailCustomSettings.json(from: defaults)
    DevicePreferences.setRememberPage(true, in: defaults)
    DevicePreferences.recordPage(URL(string: "https://app.fastmail.com/mail/Archive"), in: defaults)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Archive")
    #expect(FastmailCustomSettings.json(from: defaults) == before)
    defaults.removePersistentDomain(forName: suite)
}

// The switch is not a setting, so a flip leaves the settings as they were;
// the pusher compares the whole script, which carries the switch
@Test func aFlippedSyncSwitchIsPushedAndAnUnchangedOneIsNot() {
    let suite = "pusher-sync-switch-test"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    let on = FastmailCustomSettings.applyScriptSource(from: defaults, syncEnabled: true)
    let off = FastmailCustomSettings.applyScriptSource(from: defaults, syncEnabled: false)
    #expect(FastmailCustomSettingsPusher.shouldPush(off, after: on, force: false))
    #expect(!FastmailCustomSettingsPusher.shouldPush(off, after: off, force: false))
    defaults.removePersistentDomain(forName: suite)
}
