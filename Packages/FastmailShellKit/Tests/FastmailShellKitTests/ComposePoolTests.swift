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

#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit

@MainActor
private func makePlainWindow() -> NSWindow {
    NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
        styleMask: [.titled, .closable],
        backing: .buffered,
        defer: true
    )
}

// A message can be written in a tab of the window it was asked from, but a
// compose window will not host one — those refuse tabs — so from inside one it
// opens on its own instead.
@Test @MainActor func aComposeTabNeedsAWindowThatTakesTabs() {
    let main = makePlainWindow()
    let compose = makePlainWindow()
    compose.tabbingMode = .disallowed
    #expect(ComposeWindows.tabHost(main) === main)
    #expect(ComposeWindows.tabHost(compose) == nil)
    #expect(ComposeWindows.tabHost(nil) == nil)
}

// Compose windows are reused, so being a tab is undone before one goes back:
// the next message must not turn up in a group it was never asked into.
@Test @MainActor func aComposeWindowGoingBackToThePoolRefusesTabsAgain() {
    let host = makePlainWindow()
    let compose = makePlainWindow()
    compose.tabbingMode = .preferred
    host.addTabbedWindow(compose, ordered: .above)
    #expect(compose.tabGroup != nil)
    ComposeWindows.readyForPool(compose)
    #expect(compose.tabbingMode == .disallowed)
    #expect(compose.tabGroup == nil)
}
#endif
