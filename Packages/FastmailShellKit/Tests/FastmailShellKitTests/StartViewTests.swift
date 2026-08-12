import Foundation
import Testing
@testable import FastmailShellKit

private let fallback = URL(string: "https://app.fastmail.com/")!

@Test func emptyOrMissingFallsBack() {
    #expect(StartView.resolve(nil, default: fallback) == fallback)
    #expect(StartView.resolve("", default: fallback) == fallback)
    #expect(StartView.resolve("   ", default: fallback) == fallback)
}

@Test func aFastmailURLIsUsedAsIs() {
    let raw = "https://app.fastmail.com/mail/search:from%3Aboss"
    #expect(StartView.resolve(raw, default: fallback) == URL(string: raw)!)
}

@Test func aURLKeepsItsQueryAndFragment() {
    let raw = "https://app.fastmail.com/mail/Inbox?u=abc#thread"
    #expect(StartView.resolve(raw, default: fallback) == URL(string: raw)!)
}

@Test func surroundingWhitespaceIsTolerated() {
    let raw = "https://app.fastmail.com/mail/Archive"
    #expect(StartView.resolve("  \(raw)  ", default: fallback) == URL(string: raw)!)
}

@Test func aBareViewNameIsNotAURLAndFallsBack() {
    #expect(StartView.resolve("Inbox", default: fallback) == fallback)
    #expect(StartView.resolve("/mail/Inbox", default: fallback) == fallback)
    #expect(StartView.resolve("app.fastmail.com/mail/Inbox", default: fallback) == fallback)
}

@Test func aURLOnAnotherHostFallsBack() {
    #expect(StartView.resolve("https://evil.example/mail/Inbox", default: fallback) == fallback)
    #expect(StartView.resolve("https://www.fastmail.com/help/", default: fallback) == fallback)
    #expect(StartView.resolve("https://app.fastmail.com.evil.example/", default: fallback) == fallback)
}

@Test func aNonHTTPSSchemeFallsBack() {
    #expect(StartView.resolve("http://app.fastmail.com/mail/Inbox", default: fallback) == fallback)
    #expect(StartView.resolve("javascript:alert(1)", default: fallback) == fallback)
    #expect(StartView.resolve("file:///etc/passwd", default: fallback) == fallback)
}

@Test func hostComparisonIsCaseInsensitiveButRejectsATrailingDot() {
    #expect(StartView.resolve("https://APP.FASTMAIL.COM/mail/Inbox", default: fallback)
        == URL(string: "https://APP.FASTMAIL.COM/mail/Inbox")!)
    #expect(StartView.resolve("https://app.fastmail.com./mail/Inbox", default: fallback) == fallback)
}

@Test func aValueThatCannotBecomeAURLFallsBack() {
    #expect(StartView.resolve("\u{2028}\u{FFFF}", default: fallback) == fallback)
}

@Test func profileReadsTheSettingFromDefaults() {
    let defaults = UserDefaults(suiteName: "start-view-test")!
    defaults.removePersistentDomain(forName: "start-view-test")
    let profile = Profile.personal(accountID: nil)
    #expect(profile.startURL(readingFrom: defaults) == profile.startURL)
    defaults.set("https://app.fastmail.com/mail/Archive", forKey: StartView.defaultsKey)
    #expect(profile.startURL(readingFrom: defaults)
        == URL(string: "https://app.fastmail.com/mail/Archive")!)
    defaults.removePersistentDomain(forName: "start-view-test")
}
