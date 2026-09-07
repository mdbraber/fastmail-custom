import Foundation
import Testing
@testable import FastmailShellKit

@Test func eachBackendHasItsOwnHost() {
    #expect(Backend.production.host == "app.fastmail.com")
    #expect(Backend.beta.host == "app.beta.fastmail.com")
    #expect(Backend.production.baseURL == URL(string: "https://app.fastmail.com/")!)
    #expect(Backend.beta.baseURL == URL(string: "https://app.beta.fastmail.com/")!)
    #expect(Set(Backend.knownHosts) == ["app.fastmail.com", "app.beta.fastmail.com"])
}

@Test func aStoredNameResolvesToItsCase() {
    #expect(Backend.resolve("production") == .production)
    #expect(Backend.resolve("beta") == .beta)
    #expect(Backend.resolve("  Beta  ") == .beta)
    #expect(Backend.resolve("BETA") == .beta)
}

// Both shells run against beta, so that is what an unset backend means.
// Named here rather than spelled out, so the day it changes this test says
// so once instead of in every address a default reaches.
@Test func theStandardBackendIsBeta() {
    #expect(Backend.standard == .beta)
}

// Settings.bundle writes this key as a plain string, so an unknown value is
// something that can genuinely arrive rather than a case that cannot happen
@Test func anUnknownOrMissingNameIsTheStandardBackend() {
    #expect(Backend.resolve(nil) == .standard)
    #expect(Backend.resolve("") == .standard)
    #expect(Backend.resolve("   ") == .standard)
    #expect(Backend.resolve("staging") == .standard)
}

@Test func currentReadsTheSettingFromDefaults() {
    let suite = "backend-current-test"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    #expect(Backend.current(defaults) == .standard)
    // A chosen backend outranks the default, whichever way round they are
    defaults.set("production", forKey: Backend.defaultsKey)
    #expect(Backend.current(defaults) == .production)
    defaults.set("beta", forKey: Backend.defaultsKey)
    #expect(Backend.current(defaults) == .beta)
    defaults.removePersistentDomain(forName: suite)
}

@Test func rehostMovesAnAddressAcrossKeepingEverythingElse() {
    let url = URL(string: "https://app.fastmail.com/mail/Inbox?u=abc#thread")!
    #expect(Backend.beta.rehost(url)
        == URL(string: "https://app.beta.fastmail.com/mail/Inbox?u=abc#thread")!)
    #expect(Backend.production.rehost(url) == url)
}

@Test func rehostLeavesAnAddressWithNoHostAlone() {
    let hostless = URL(string: "mailto:someone@example.com")!
    #expect(Backend.beta.rehost(hostless) == hostless)
}
