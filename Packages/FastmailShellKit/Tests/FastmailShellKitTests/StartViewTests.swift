import Foundation
import Testing
@testable import FastmailShellKit

private let fallback = URL(string: "https://app.fastmail.com/")!

@Test func emptyOrMissingFallsBack() {
    #expect(StartView.resolve(nil, default: fallback, backend: .production) == fallback)
    #expect(StartView.resolve("", default: fallback, backend: .production) == fallback)
    #expect(StartView.resolve("   ", default: fallback, backend: .production) == fallback)
}

// The field holds a path; the host comes from the backend.
@Test func aPathIsPlacedOnTheBackend() {
    #expect(StartView.resolve("/mail/Inbox", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/mail/Inbox")!)
    #expect(StartView.resolve("/mail/Archive", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/mail/Archive")!)
}

@Test func aPathWithoutALeadingSlashStillWorks() {
    #expect(StartView.resolve("mail/Inbox", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/mail/Inbox")!)
    #expect(StartView.resolve("Inbox", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/Inbox")!)
}

@Test func aPathKeepsItsQueryAndFragment() {
    #expect(StartView.resolve("/mail/Inbox?u=abc#thread", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/mail/Inbox?u=abc#thread")!)
}

@Test func surroundingWhitespaceIsTolerated() {
    #expect(StartView.resolve("  /mail/Archive  ", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/mail/Archive")!)
}

// The backend decides the host, whether the field is empty or holds a path.
@Test func theBackendDecidesTheHost() {
    #expect(StartView.resolve(nil, default: fallback, backend: .beta)
        == URL(string: "https://app.beta.fastmail.com/")!)
    #expect(StartView.resolve("/mail/Inbox", default: fallback, backend: .beta)
        == URL(string: "https://app.beta.fastmail.com/mail/Inbox")!)
}

// A pasted full address is tolerated but reduced to its path, and moved onto
// the selected backend — the host that was typed never survives.
@Test func aFullAddressIsReducedToItsPath() {
    #expect(StartView.resolve("https://app.fastmail.com/mail/Archive", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/mail/Archive")!)
    #expect(StartView.resolve("https://app.beta.fastmail.com/mail/Inbox?u=abc", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/mail/Inbox?u=abc")!)
    #expect(StartView.resolve("https://app.fastmail.com/mail/Archive", default: fallback, backend: .beta)
        == URL(string: "https://app.beta.fastmail.com/mail/Archive")!)
}

@Test func aPastedAddressKeepsItsEncodedPathQueryAndFragment() {
    let raw = "https://app.fastmail.com/mail/search:from%3Aboss"
    #expect(StartView.resolve(raw, default: fallback, backend: .production) == URL(string: raw)!)
    #expect(StartView.resolve("https://app.fastmail.com/mail/Inbox?u=abc#thread", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/mail/Inbox?u=abc#thread")!)
}

// The host on a pasted address is replaced, not compared, so a shouted one
// comes back in the backend's own spelling — and a trailing dot is not it.
@Test func aPastedHostIsCaseInsensitiveButATrailingDotIsRejected() {
    #expect(StartView.resolve("https://APP.FASTMAIL.COM/mail/Inbox", default: fallback, backend: .production)
        == URL(string: "https://app.fastmail.com/mail/Inbox")!)
    #expect(StartView.resolve("https://app.fastmail.com./mail/Inbox", default: fallback, backend: .production) == fallback)
}

@Test func aFullAddressOnAnotherHostFallsBack() {
    #expect(StartView.resolve("https://evil.example/mail/Inbox", default: fallback, backend: .production) == fallback)
    #expect(StartView.resolve("https://www.fastmail.com/help/", default: fallback, backend: .production) == fallback)
    #expect(StartView.resolve("https://app.fastmail.com.evil.example/", default: fallback, backend: .production) == fallback)
}

@Test func aNonHTTPSSchemeFallsBack() {
    #expect(StartView.resolve("http://app.fastmail.com/mail/Inbox", default: fallback, backend: .production) == fallback)
    #expect(StartView.resolve("javascript:alert(1)", default: fallback, backend: .production) == fallback)
    #expect(StartView.resolve("file:///etc/passwd", default: fallback, backend: .production) == fallback)
}

@Test func anUnknownHostStillFallsBackOnTheSelectedBackend() {
    #expect(StartView.resolve("https://evil.example/mail/Inbox", default: fallback, backend: .beta)
        == URL(string: "https://app.beta.fastmail.com/")!)
    #expect(StartView.resolve("http://app.beta.fastmail.com/", default: fallback, backend: .beta)
        == URL(string: "https://app.beta.fastmail.com/")!)
}

@Test func profileReadsTheSettingFromDefaults() {
    let defaults = UserDefaults(suiteName: "start-view-test")!
    defaults.removePersistentDomain(forName: "start-view-test")
    // Which server is the other setting, and it has a test of its own below.
    // Named here so this one is about the start view alone.
    defaults.set(Backend.production.rawValue, forKey: Backend.defaultsKey)
    let profile = Profile.personal(accountID: nil)
    #expect(profile.startURL(readingFrom: defaults) == profile.startURL)
    defaults.set("/mail/Archive", forKey: StartView.defaultsKey)
    #expect(profile.startURL(readingFrom: defaults)
        == URL(string: "https://app.fastmail.com/mail/Archive")!)
    defaults.removePersistentDomain(forName: "start-view-test")
}

@Test func profileFollowsTheBackendSetting() {
    let suite = "start-view-backend-test"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    let profile = Profile.personal(accountID: nil)
    defaults.set("beta", forKey: Backend.defaultsKey)
    #expect(profile.startURL(readingFrom: defaults)
        == URL(string: "https://app.beta.fastmail.com/")!)
    defaults.set("/mail/Archive", forKey: StartView.defaultsKey)
    #expect(profile.startURL(readingFrom: defaults)
        == URL(string: "https://app.beta.fastmail.com/mail/Archive")!)
    defaults.removePersistentDomain(forName: suite)
}
