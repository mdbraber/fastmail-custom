import Foundation
import Testing
@testable import FastmailShellKit

// Applying settings makes the page drop its caches and ask the server for
// counts again, so a defaults write that changed nothing the page reads, such
// as the page the app is on, must not reach it.
@Test func settingsThePageAlreadyHasAreNotPushedAgain() {
    #expect(!CustomModeSettingsPusher.shouldPush(#"{"a":true}"#, after: #"{"a":true}"#, force: false))
}

@Test func changedSettingsArePushed() {
    #expect(CustomModeSettingsPusher.shouldPush(#"{"a":false}"#, after: #"{"a":true}"#, force: false))
}

// A page that has only what it started with gets the next push, as it always did.
@Test func aPageThatWasNeverPushedToGetsTheNextPush() {
    #expect(CustomModeSettingsPusher.shouldPush(#"{"a":true}"#, after: nil, force: false))
}

// Coming back to the front pushes regardless, as it always did.
@Test func aForcedPushAlwaysGoes() {
    #expect(CustomModeSettingsPusher.shouldPush(#"{"a":true}"#, after: #"{"a":true}"#, force: true))
}

@Test func savingThePageLeavesTheCustomModeSettingsAsTheyWere() {
    let suite = "pusher-last-page-test"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    defaults.set(true, forKey: CustomModeSettings.defaultsKey(for: "filteredLabelCounts"))
    let before = CustomModeSettings.json(from: defaults)
    DevicePreferences.setRememberPage(true, in: defaults)
    DevicePreferences.recordPage(URL(string: "https://app.fastmail.com/mail/Archive"), in: defaults)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Archive")
    #expect(CustomModeSettings.json(from: defaults) == before)
    defaults.removePersistentDomain(forName: suite)
}
