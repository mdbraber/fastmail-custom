import Foundation
import Testing
@testable import FastmailShellKit

private final class FakeWindow {}

@Test @MainActor func takingFromThePoolReturnsThePreloadedWindowWithoutReloading() {
    var created = 0
    var prepared = 0
    let pool = ComposePool<FakeWindow>(
        create: { created += 1; return FakeWindow() },
        prepare: { _ in prepared += 1 }
    )
    pool.preload()
    #expect(created == 1)
    #expect(prepared == 1)
    let window = pool.take()
    #expect(created == 1)
    #expect(prepared == 1)
    #expect(pool.pooled == nil)
    _ = window
}

@Test @MainActor func anEmptyPoolCreatesAFreshWindowRatherThanFailing() {
    var created = 0
    let pool = ComposePool<FakeWindow>(
        create: { created += 1; return FakeWindow() },
        prepare: { _ in }
    )
    let first = pool.take()
    let second = pool.take()
    #expect(created == 2)
    #expect(first !== second)
}

@Test @MainActor func aSpentWindowReturnsToThePoolReloaded() {
    var prepared = 0
    let pool = ComposePool<FakeWindow>(
        create: { FakeWindow() },
        prepare: { _ in prepared += 1 }
    )
    pool.preload()
    let window = pool.take()
    #expect(pool.shouldRecycle(window))
    #expect(prepared == 2)
    #expect(pool.pooled === window)
    #expect(pool.take() === window)
}

@Test @MainActor func aSecondClosingComposeReallyCloses() {
    let pool = ComposePool<FakeWindow>(
        create: { FakeWindow() },
        prepare: { _ in }
    )
    let first = pool.take()
    let second = pool.take()
    #expect(pool.shouldRecycle(first))
    #expect(!pool.shouldRecycle(second))
}

@Test func theComposeURLCarriesTheAccountOnlyWhenKnown() {
    let with = Profile(
        id: "personal",
        displayName: "Test",
        startURL: URL(string: "https://app.fastmail.com/")!,
        overlayScriptName: nil,
        urlScheme: "fastmail-personal",
        accountID: "f00dcafe",
        backend: .production
    )
    let without = Profile(
        id: "personal",
        displayName: "Test",
        startURL: URL(string: "https://app.fastmail.com/")!,
        overlayScriptName: nil,
        urlScheme: "fastmail-personal",
        accountID: nil,
        backend: .production
    )
    #expect(ComposeURL.url(for: with).absoluteString == "https://app.fastmail.com/mail/Inbox/compose?u=f00dcafe&ui=minimal")
    #expect(ComposeURL.url(for: without).absoluteString == "https://app.fastmail.com/mail/Inbox/compose?ui=minimal")
}

// A compose window opened for a mailto carries the message, on the path that
// is known to accept one, with the same minimal chrome a blank one gets.
@Test func aComposeWindowForAMailtoCarriesTheMessage() {
    let profile = Profile(
        id: "personal",
        displayName: "Test",
        startURL: URL(string: "https://app.fastmail.com/")!,
        overlayScriptName: nil,
        urlScheme: "fastmail-personal",
        accountID: "f00dcafe",
        backend: .production
    )
    let composed = ComposeURL.url(for: profile, mailto: "mailto:a@b.com?subject=Tea & biscuits")
    #expect(composed.absoluteString.hasPrefix("https://app.fastmail.com/mail/compose?mailto="))
    let query = composed.query ?? ""
    #expect(query.contains("u=f00dcafe"))
    #expect(query.contains("ui=minimal"))
    // The ampersand belongs to the subject, so it must not read as a separator.
    #expect(query.contains("%26"))
}
