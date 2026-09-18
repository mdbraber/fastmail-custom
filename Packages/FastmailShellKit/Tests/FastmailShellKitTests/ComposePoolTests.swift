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

// Taking a window out of the pool is what lets its page count as an open
// window, whether it was loaded ahead of time or only just made; going back
// into the pool is not.
@Test @MainActor func everyWindowTakenFromThePoolIsReleasedFromIt() {
    var released: [FakeWindow] = []
    let pool = ComposePool<FakeWindow>(
        create: { FakeWindow() },
        prepare: { _ in },
        release: { released.append($0) }
    )
    pool.preload()
    #expect(released.isEmpty)
    let preloaded = pool.take()
    let fresh = pool.take()
    #expect(released.count == 2)
    #expect(released.first === preloaded)
    #expect(released.last === fresh)
    #expect(pool.shouldRecycle(preloaded))
    #expect(released.count == 2)
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

// A draft opens at Fastmail's own address for one, keeping the account and
// the minimal chrome, and an id that is not one builds no address at all.
@Test func aDraftOpensAtFastmailsAddressForIt() {
    let compose = URL(string: "https://app.fastmail.com/mail/Inbox/compose?u=f00dcafe&ui=minimal")!
    let draft = ComposeURL.url(from: compose, draft: "Sto3rHszPGgk")
    #expect(draft?.path == "/mail/compose/Sto3rHszPGgk")
    let query = draft?.query ?? ""
    #expect(query.contains("u=f00dcafe"))
    #expect(query.contains("ui=minimal"))
    #expect(query.contains("mode=draft"))
    #expect(ComposeURL.url(from: compose, draft: "") == nil)
    #expect(ComposeURL.url(from: compose, draft: "../settings") == nil)
    #expect(ComposeURL.url(from: compose, draft: "a b") == nil)
}

// Drafts are left to Fastmail until the setting says otherwise, and then
// go wherever a new message would.
@Test func draftsFollowTheSettingOnlyWhenAskedTo() {
    #expect(ComposeMode.editDraftFollowsCompose(in: [:]) == false)
    #expect(ComposeMode.editDraftFollowsCompose(in: ["editDraftFollowsCompose": true]) == true)
    #expect(ComposeMode.editDraft(follows: false, setting: .tab) == nil)
    #expect(ComposeMode.editDraft(follows: true, setting: .tab) == .tab)
    #expect(ComposeMode.editDraft(follows: true, setting: .inline) == .inline)
    #expect(ComposeMode.editDraft(follows: true, setting: .window) == .window)
}

// Where a message opens when you ask for one without saying where: in the
// page, in a tab, or in a window of its own.
@Test func aMessageOpensInAWindowUnlessToldOtherwise() {
    #expect(ComposeMode.stored(in: [:]) == .window)
    #expect(ComposeMode.stored(in: ["composeMode": "inline"]) == .inline)
    #expect(ComposeMode.stored(in: ["composeMode": "tab"]) == .tab)
    #expect(ComposeMode.stored(in: ["composeMode": "window"]) == .window)
    // Something unreadable is not an answer.
    #expect(ComposeMode.stored(in: ["composeMode": "sideways"]) == .window)
}

// What the page watches for; the C key, and the Compose button, and what each
// combination asks for.
@Test func theComposeKeysSayWhereTheyWantIt() {
    #expect(ComposeMode.asked(alt: false, command: false, shift: false) == "default")
    #expect(ComposeMode.asked(alt: true, command: false, shift: false) == "inline")
    #expect(ComposeMode.asked(alt: true, command: true, shift: false) == "tab")
    // Command alone is Copy, and Shift is Fastmail's own business.
    #expect(ComposeMode.asked(alt: false, command: true, shift: false) == nil)
    #expect(ComposeMode.asked(alt: false, command: false, shift: true) == nil)
    #expect(ComposeMode.asked(alt: true, command: true, shift: true) == nil)
}

// What a request from the page comes to, once the setting has had its say.
@Test func plainCFollowsTheSettingAndTheOthersDoNot() {
    #expect(ComposeMode.resolve(asked: "default", setting: .tab) == .tab)
    #expect(ComposeMode.resolve(asked: "default", setting: .inline) == .inline)
    #expect(ComposeMode.resolve(asked: "tab", setting: .inline) == .tab)
    #expect(ComposeMode.resolve(asked: "inline", setting: .window) == .inline)
    #expect(ComposeMode.resolve(asked: "sideways", setting: .window) == nil)
}

#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import WebKit

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
// compose window will not host one; those refuse tabs; so from inside one it
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

// A message opens offset from the window it was asked from, so the window
// underneath is visible behind it rather than hidden exactly beneath.
@Test @MainActor func aMessageStandsOffFromTheWindowBelowIt() {
    let host = NSRect(x: 100, y: 100, width: 1000, height: 900)
    let corner = ComposeWindows.topLeft(offsetFrom: host, by: 36)
    #expect(corner.x == 136)
    // Down, in a coordinate space that counts upwards.
    #expect(corner.y == 964)
}

// A message written in a tab starts where its neighbours' pages start: below
// the bar, with the same band of window colour above it.
@Test @MainActor func aComposeTabStartsWhereAMailPageStarts() {
    #expect(ComposeWindows.pageTop(barBottom: 94, air: 14, band: 52) == 108)
}

// Pulled out into a window of its own it keeps the colour but loses the bar,
// so it falls back to the band that holds the window buttons; the same height
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
// it; the room taken on the left is taken on the right too.
@Test @MainActor func theRecipientsSitLevelWithTheButtonsAndCentredInTheWindow() {
    let bounds = NSRect(x: 0, y: 0, width: 760, height: 640)
    let frame = ComposeWindows.labelFrame(in: bounds, band: 52, buttonsRight: 78, height: 18)
    #expect(bounds.height - frame.midY == 26)
    #expect(frame.minX > 78)
    #expect(bounds.width - frame.maxX == frame.minX)
}

// Nothing addressed yet, nothing to say; unless the window is holding a
// message being read rather than written, which is named by its subject.
@Test @MainActor func theBandNamesWhoeverItIsForOrWhatItIsAbout() {
    #expect(ComposeWindows.bandTitle(
        composing: true, recipients: " Anne  Marie ", pageTitle: "Compose message"
    ) == "Anne  Marie")
    // Being written, addressed to no one: it says what it is.
    #expect(ComposeWindows.bandTitle(
        composing: true, recipients: "", pageTitle: "Compose message"
    ) == "New message")
    #expect(ComposeWindows.bandTitle(
        composing: false, recipients: "", pageTitle: "Lunch"
    ) == "Lunch")
}

@Test @MainActor func aMessageBeingWrittenKeepsItsNameInTheWindowMenu() {
    #expect(ComposeWindows.windowTitle(composing: true, pageTitle: "Compose message") == "New Message")
    #expect(ComposeWindows.windowTitle(composing: false, pageTitle: "Lunch") == "Lunch")
    #expect(ComposeWindows.windowTitle(composing: false, pageTitle: "") == "New Message")
}

// The page a popout is asked from hands out its own WKWebViewConfiguration
// again for every message it pops out, closed or not; WKUserContentController
// raises an uncatchable exception on a second addScriptMessageHandler for the
// same name, which used to crash the app the second time someone used the
// popout button.
@Test @MainActor func aSecondPopoutFromTheSamePageDoesNotReaddTheSameHandler() {
    let configuration = WKWebViewConfiguration()
    _ = ComposeWindows.shared.window(for: configuration, size: NSSize(width: 400, height: 400))
    _ = ComposeWindows.shared.window(for: configuration, size: NSSize(width: 400, height: 400))
}

// A compose page waiting in the pool carries the script that keeps it off
// Fastmail's roll call of open windows, ahead of anything Fastmail runs; once
// the window is opened its pages load without it, and still watch the To line.
// Both run Fastmail as its desktop app, through the harness, marked as a
// compose window's first, with the settings and the userscript as in the
// mailbox window.
@Test @MainActor func onlyAComposePageWaitingInThePoolCarriesThePoolScript() {
    let controller = WKUserContentController()
    ComposeWindows.composeHost = "app.fastmail.com"
    ComposeWindows.composeURL = URL(string: "https://app.fastmail.com/mail/Inbox/compose?ui=minimal")
    ComposeWindows.scriptLoader = StubScripts()
    defer { ComposeWindows.scriptLoader = BundleResourceLoader() }
    // The bridge needs a notification centre, which a test has none of
    ComposeWindows.bridgedControllers.insert(ObjectIdentifier(controller))
    ComposeWindows.useScripts(pooled: true, in: controller)
    #expect(controller.userScripts.count == 6)
    let settings = controller.userScripts.firstIndex { $0.source.hasPrefix("window.__fastmailCustomSettings = ") }
    let userScript = controller.userScripts.firstIndex { $0.source.contains("window.stubUserScript = true") }
    let harnessAt = controller.userScripts.firstIndex { $0.source.contains("window.electron = {") }
    #expect(settings != nil && harnessAt != nil && userScript != nil)
    #expect(settings! < harnessAt! && harnessAt! < userScript!)
    let pooled = controller.userScripts.filter { $0.source == ComposeWindows.poolScript }
    #expect(pooled.count == 1)
    #expect(pooled.first?.injectionTime == .atDocumentStart)
    #expect(pooled.first?.isForMainFrameOnly == true)
    let marker = controller.userScripts.firstIndex { $0.source == ComposeWindows.composeMarkerScript }
    let harness = controller.userScripts.firstIndex { $0.source.contains("window.electron = {") }
    #expect(marker != nil && harness != nil && marker! < harness!)

    ComposeWindows.useScripts(pooled: false, in: controller)
    #expect(controller.userScripts.count == 5)
    #expect(!controller.userScripts.contains { $0.source == ComposeWindows.poolScript })
    #expect(controller.userScripts.contains { $0.source.contains("window.electron = {") })
}

private struct StubScripts: ResourceLoading {
    func string(named name: String) -> String? {
        switch name {
        case "harness.js": return "window.electron = {};"
        case "userscript.js":
            return """
            // ==UserScript==
            // @name Stub
            // @match https://app.fastmail.com/*
            // ==/UserScript==
            window.stubUserScript = true;
            """
        default: return nil
        }
    }
}

// Without a server to answer to there is no harness to gate, and none is added
@Test @MainActor func noComposeHostMeansNoHarness() {
    let controller = WKUserContentController()
    ComposeWindows.composeHost = ""
    ComposeWindows.useScripts(pooled: false, in: controller)
    #expect(controller.userScripts.count == 1)
}
#endif
