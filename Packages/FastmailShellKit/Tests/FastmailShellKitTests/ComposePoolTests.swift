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
        accountID: "f00dcafe"
    )
    let without = Profile(
        id: "personal",
        displayName: "Test",
        startURL: URL(string: "https://app.fastmail.com/")!,
        overlayScriptName: nil,
        urlScheme: "fastmail-personal",
        accountID: nil
    )
    #expect(ComposeURL.url(for: with).absoluteString == "https://app.fastmail.com/mail/Inbox/compose?u=f00dcafe&ui=minimal")
    #expect(ComposeURL.url(for: without).absoluteString == "https://app.fastmail.com/mail/Inbox/compose?ui=minimal")
}
