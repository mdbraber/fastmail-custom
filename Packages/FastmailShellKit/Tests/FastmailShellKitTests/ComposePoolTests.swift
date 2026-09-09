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

// A message written in a tab starts where its neighbours' pages start: below
// the bar, with the same band of window colour above it.
@Test @MainActor func aComposeTabStartsWhereAMailPageStarts() {
    #expect(ComposeWindows.pageTop(barBottom: 94, air: 14, band: 52) == 108)
}

// Pulled out into a window of its own it keeps the colour but loses the bar,
// so it falls back to the band that holds the window buttons — the same height
// as the header a mailbox page keeps above itself.
@Test @MainActor func aComposeWindowOnItsOwnKeepsOnlyTheButtonsBand() {
    #expect(ComposeWindows.pageTop(barBottom: nil, air: 14, band: 52) == 52)
    // Nothing measured from a page yet: the band is all there is to go on.
    #expect(ComposeWindows.pageTop(barBottom: 94, air: nil, band: 52) == 52)
}

// That band is exactly deep enough to hold the window buttons with as much
// room under them as over them.
@Test @MainActor func theBandHoldsTheWindowButtonsEvenly() throws {
    let window = makePlainWindow()
    ComposeWindows.dress(window, like: makePlainWindow())
    window.layoutIfNeeded()
    let close = try #require(window.standardWindowButton(.closeButton))
    let container = try #require(close.superview)
    let fromTop = window.frame.height - container.convert(close.frame, to: nil).maxY
    let band = try #require(ComposeWindows.band(of: window))
    #expect(band - (fromTop + close.frame.height) == fromTop)
}

// Joining a window it takes that window's chrome: the same title bar height,
// so the tab bar does not jump, and the same colour behind it.
@Test @MainActor func aComposeWindowTakesTheChromeOfTheWindowItJoins() {
    let host = makePlainWindow()
    host.backgroundColor = .systemGreen
    let compose = makePlainWindow()

    ComposeWindows.dress(compose, like: host)
    #expect(compose.toolbar != nil)
    #expect(compose.titlebarAppearsTransparent)
    #expect(compose.titleVisibility == .hidden)
    #expect(compose.backgroundColor == host.backgroundColor)
    #expect(ComposeWindows.isDressed(compose))
}

// Going back to the pool it gives up only its place in the group: every
// message wears the chrome, so the next one to be written keeps it.
@Test @MainActor func aComposeWindowGivesUpItsGroupButKeepsItsChrome() {
    let host = makePlainWindow()
    let compose = makePlainWindow()
    ComposeWindows.dress(compose, like: host)
    compose.tabbingMode = .preferred
    host.addTabbedWindow(compose, ordered: .above)

    ComposeWindows.readyForPool(compose)
    #expect(compose.tabGroup == nil)
    #expect(compose.tabbingMode == .disallowed)
    #expect(ComposeWindows.isDressed(compose))
}

// The band carries who the message is going to, level with the window buttons
// and clear of them, and centred in the window rather than in what is left of
// it — the room taken on the left is taken on the right too.
@Test @MainActor func theRecipientsSitLevelWithTheButtonsAndCentredInTheWindow() {
    let bounds = NSRect(x: 0, y: 0, width: 760, height: 640)
    let frame = ComposeWindows.labelFrame(in: bounds, band: 52, buttonsRight: 78, height: 18)
    #expect(bounds.height - frame.midY == 26)
    #expect(frame.minX > 78)
    #expect(bounds.width - frame.maxX == frame.minX)
}

// Nothing addressed yet, nothing to say.
@Test @MainActor func anUnaddressedMessageSaysNothingInItsBand() {
    #expect(ComposeWindows.bandTitle(recipients: "") == "")
    #expect(ComposeWindows.bandTitle(recipients: "  ") == "")
    #expect(ComposeWindows.bandTitle(recipients: " Anne  Marie ") == "Anne  Marie")
}
#endif
