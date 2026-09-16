import Foundation
import Testing
@testable import FastmailShellKit

private func freshDefaults(_ suite: String) -> UserDefaults {
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

@Test func theDeviceSettingsKeysAreTheAgreedNames() {
    #expect(DevicePreferences.screenLockKey == "device.screenLock")
    #expect(DevicePreferences.rememberPageKey == "device.rememberPage")
    #expect(DevicePreferences.lastPageKey == "device.lastPage")
    #expect(DevicePreferences.inAppBrowserKey == "device.inAppBrowser")
    #expect(DevicePreferences.remoteDebuggingKey == "device.remoteDebugging")
}

@Test func nothingStoredReadsAsTheDefaults() {
    let suite = "device-preferences-defaults-test"
    let defaults = freshDefaults(suite)
    #expect(DevicePreferences.screenLock(in: defaults) == false)
    #expect(DevicePreferences.rememberPage(in: defaults) == false)
    #expect(DevicePreferences.lastPage(in: defaults) == nil)
    #expect(DevicePreferences.inAppBrowser(in: defaults) == true)
    #expect(DevicePreferences.remoteDebugging(in: defaults) == true)
    defaults.removePersistentDomain(forName: suite)
}

@Test func storedValuesOutrankTheDefaults() {
    let suite = "device-preferences-stored-test"
    let defaults = freshDefaults(suite)
    defaults.set(true, forKey: DevicePreferences.screenLockKey)
    defaults.set(true, forKey: DevicePreferences.rememberPageKey)
    defaults.set("/mail/Archive", forKey: DevicePreferences.lastPageKey)
    defaults.set(false, forKey: DevicePreferences.inAppBrowserKey)
    defaults.set(false, forKey: DevicePreferences.remoteDebuggingKey)
    #expect(DevicePreferences.screenLock(in: defaults) == true)
    #expect(DevicePreferences.rememberPage(in: defaults) == true)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Archive")
    #expect(DevicePreferences.inAppBrowser(in: defaults) == false)
    #expect(DevicePreferences.remoteDebugging(in: defaults) == false)
    defaults.removePersistentDomain(forName: suite)
}

@Test func aStoredPageThatIsNotAPathIsIgnored() {
    let suite = "device-preferences-bad-page-test"
    let defaults = freshDefaults(suite)
    for stored in ["mail/Inbox", "https://app.fastmail.com/mail/Inbox", "//evil.example/mail", ""] {
        defaults.set(stored, forKey: DevicePreferences.lastPageKey)
        #expect(DevicePreferences.lastPage(in: defaults) == nil, "\(stored)")
    }
    defaults.removePersistentDomain(forName: suite)
}

@Test func aPageOnAKnownFastmailHostKeepsItsPathQueryAndFragment() {
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://app.fastmail.com/mail/Inbox/T1.M2?u=abc#reply"))
        == "/mail/Inbox/T1.M2?u=abc#reply")
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://app.beta.fastmail.com/mail/Archive/"))
        == "/mail/Archive/")
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://APP.FASTMAIL.COM/calendar/"))
        == "/calendar/")
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://app.fastmail.com/settings/custom-options"))
        == "/settings/custom-options")
    // Kept as it is encoded, so it opens exactly as it was
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://app.fastmail.com/mail/search:from%3Aboss"))
        == "/mail/search:from%3Aboss")
}

@Test func otherHostsAndSchemesAreNotSaved() {
    let refused = [
        "https://example.com/mail/Inbox",
        "https://www.fastmail.com/help/",
        "https://app.fastmail.com.evil.example/mail/Inbox",
        "http://app.fastmail.com/mail/Inbox",
        "about:blank"
    ]
    for address in refused {
        #expect(DevicePreferences.rememberablePath(of: URL(string: address)) == nil, "\(address)")
    }
    #expect(DevicePreferences.rememberablePath(of: nil) == nil)
}

@Test func theLoginPageAndMessagesBeingWrittenAreNotSaved() {
    let refused = [
        "https://app.fastmail.com/login/",
        "https://app.fastmail.com/login/?redirect=%2Fmail%2FInbox",
        "https://app.fastmail.com/",
        "https://app.fastmail.com/mail/compose?mailto=mailto%3Aa%40b.com&u=abc",
        "https://app.fastmail.com/mail/Inbox/compose?u=abc"
    ]
    for address in refused {
        #expect(DevicePreferences.rememberablePath(of: URL(string: address)) == nil, "\(address)")
    }
}

@Test func thePageIsSavedOnlyWhileTheSwitchIsOn() {
    let suite = "device-preferences-record-test"
    let defaults = freshDefaults(suite)
    let inbox = URL(string: "https://app.fastmail.com/mail/Inbox/?u=abc")!
    DevicePreferences.recordPage(inbox, in: defaults)
    #expect(defaults.object(forKey: DevicePreferences.lastPageKey) == nil)

    DevicePreferences.setRememberPage(true, in: defaults)
    DevicePreferences.recordPage(inbox, in: defaults)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Inbox/?u=abc")

    // A page not worth saving leaves the last good one
    DevicePreferences.recordPage(URL(string: "https://app.fastmail.com/login/"), in: defaults)
    DevicePreferences.recordPage(URL(string: "https://example.com/elsewhere"), in: defaults)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Inbox/?u=abc")
    defaults.removePersistentDomain(forName: suite)
}

@Test func turningTheSwitchOffDeletesTheSavedPage() {
    let suite = "device-preferences-forget-test"
    let defaults = freshDefaults(suite)
    DevicePreferences.setRememberPage(true, in: defaults)
    DevicePreferences.recordPage(URL(string: "https://app.fastmail.com/mail/Archive"), in: defaults)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Archive")
    DevicePreferences.setRememberPage(false, in: defaults)
    #expect(DevicePreferences.rememberPage(in: defaults) == false)
    #expect(defaults.object(forKey: DevicePreferences.lastPageKey) == nil)
    defaults.removePersistentDomain(forName: suite)
}

// The launch address, in the spec's order. The first step, a link the app was
// launched with, is not this function's: AppShell routes that link once the
// app is up, and it replaces whatever was loaded here.
@Test func theLaunchAddressIsTheSavedPageThenTheStartPageThenTheDefaultView() {
    let suite = "device-preferences-launch-test"
    let defaults = freshDefaults(suite)
    let profile = Profile.personal(accountID: nil)
    defaults.set(Backend.production.rawValue, forKey: Backend.defaultsKey)

    // Nothing set: Fastmail's default view
    #expect(profile.launchURL(readingFrom: defaults) == URL(string: "https://app.fastmail.com/")!)

    // A Start page
    defaults.set("/mail/Archive", forKey: StartView.defaultsKey)
    #expect(profile.launchURL(readingFrom: defaults) == URL(string: "https://app.fastmail.com/mail/Archive")!)

    // Remembering on but nothing saved yet: still the Start page
    DevicePreferences.setRememberPage(true, in: defaults)
    #expect(profile.launchURL(readingFrom: defaults) == URL(string: "https://app.fastmail.com/mail/Archive")!)

    // A saved page outranks the Start page
    defaults.set("/mail/Inbox/T1.M2?u=abc#reply", forKey: DevicePreferences.lastPageKey)
    #expect(profile.launchURL(readingFrom: defaults)
        == URL(string: "https://app.fastmail.com/mail/Inbox/T1.M2?u=abc#reply")!)

    // A saved page is used only while the switch is on
    defaults.set(false, forKey: DevicePreferences.rememberPageKey)
    #expect(profile.launchURL(readingFrom: defaults) == URL(string: "https://app.fastmail.com/mail/Archive")!)
    defaults.removePersistentDomain(forName: suite)
}

@Test func aSavedPageIsPutOnTheCurrentBackend() {
    let suite = "device-preferences-launch-backend-test"
    let defaults = freshDefaults(suite)
    let profile = Profile.personal(accountID: nil)
    DevicePreferences.setRememberPage(true, in: defaults)
    DevicePreferences.recordPage(URL(string: "https://app.fastmail.com/mail/Archive/T9?u=abc"), in: defaults)
    defaults.set(Backend.beta.rawValue, forKey: Backend.defaultsKey)
    #expect(profile.launchURL(readingFrom: defaults)
        == URL(string: "https://app.beta.fastmail.com/mail/Archive/T9?u=abc")!)
    defaults.removePersistentDomain(forName: suite)
}
