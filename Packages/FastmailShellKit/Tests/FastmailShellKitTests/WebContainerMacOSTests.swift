#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import Testing
import WebKit
import AppKit
@testable import FastmailShellKit

@MainActor
private func makeWindow() -> NSWindow {
    NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
        styleMask: [.titled, .closable],
        backing: .buffered,
        defer: true
    )
}

@Test @MainActor func windowAwareWebViewFiresCallbackWhenMovedIntoAWindowAfterConstruction() throws {
    let webView = WindowAwareWebView(frame: .zero, configuration: WKWebViewConfiguration())
    var callbackCount = 0
    webView.onDidMoveToWindow = { callbackCount += 1 }
    #expect(callbackCount == 0)
    let window = makeWindow()
    defer { NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: window) }
    window.contentView = webView
    #expect(callbackCount >= 1)
    #expect(webView.window === window)
}

@Test @MainActor func observeFullScreenRegistersOneObserverPerWindow() throws {
    let window = makeWindow()
    let webView = WKWebView()
    defer { NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: window) }
    #expect(fullScreenObservers[ObjectIdentifier(window)] == nil)
    observeFullScreen(window, webView: webView, model: ShellModel())
    #expect(fullScreenObservers[ObjectIdentifier(window)] != nil)
}

@Test @MainActor func observeFullScreenTearsDownObserversWhenWindowCloses() throws {
    let window = makeWindow()
    let webView = WKWebView()
    observeFullScreen(window, webView: webView, model: ShellModel())
    #expect(fullScreenObservers[ObjectIdentifier(window)] != nil)
    NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: window)
    #expect(fullScreenObservers[ObjectIdentifier(window)] == nil)
}

@Test @MainActor func observeFullScreenReplacesAnExistingObserverForTheSameWindow() throws {
    let window = makeWindow()
    let webView = WKWebView()
    defer { NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: window) }
    observeFullScreen(window, webView: webView, model: ShellModel())
    let first = try #require(fullScreenObservers[ObjectIdentifier(window)])
    observeFullScreen(window, webView: webView, model: ShellModel())
    let second = try #require(fullScreenObservers[ObjectIdentifier(window)])
    #expect(first !== second)
    #expect(!first.isActive)
    #expect(second.isActive)
}

@Test @MainActor func observeFullScreenAppliesTintWhenModelPublishesIt() throws {
    let window = makeWindow()
    let webView = WKWebView()
    let model = ShellModel()
    defer { NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: window) }
    observeFullScreen(window, webView: webView, model: model)
    #expect(window.backgroundColor != NSColor(srgbRed: 214.0 / 255, green: 216.0 / 255, blue: 218.0 / 255, alpha: 1))
    model.tint = PageTint(color: "#d6d8da", isDark: false)
    #expect(window.backgroundColor == NSColor(srgbRed: 214.0 / 255, green: 216.0 / 255, blue: 218.0 / 255, alpha: 1))
    #expect(window.appearance?.name == .aqua)
}

@Test @MainActor func observeFullScreenIgnoresMalformedTint() throws {
    let window = makeWindow()
    let webView = WKWebView()
    let model = ShellModel()
    defer { NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: window) }
    observeFullScreen(window, webView: webView, model: model)
    let before = window.backgroundColor
    model.tint = PageTint(color: "not-a-color", isDark: false)
    #expect(window.backgroundColor == before)
}

@Test @MainActor func observeFullScreenStopsApplyingTintAfterWindowCloses() throws {
    let window = makeWindow()
    let webView = WKWebView()
    let model = ShellModel()
    observeFullScreen(window, webView: webView, model: model)
    NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: window)
    model.tint = PageTint(color: "#000000", isDark: true)
    #expect(window.backgroundColor != NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 1))
}

private let header = CGRect(x: 0, y: 0, width: 1200, height: 52)
private let searchField = CGRect(x: 420, y: 10, width: 360, height: 32)
private let gear = CGRect(x: 1120, y: 14, width: 24, height: 24)

@Test @MainActor func theWholeHeaderDragsWhereFastmailSaysItDoes() {
    let size = NSSize(width: 1200, height: 800)
    let point = NSPoint(x: 300, y: size.height - 26)
    #expect(TitlebarDragView.isDraggable(
        point, in: size, drag: header, noDrag: [searchField, gear], fullScreen: false
    ))
}

@Test @MainActor func fastmailsNoDragElementsStayClickable() {
    let size = NSSize(width: 1200, height: 800)
    let onSearch = NSPoint(x: 600, y: size.height - 26)
    let onGear = NSPoint(x: 1130, y: size.height - 26)
    #expect(!TitlebarDragView.isDraggable(
        onSearch, in: size, drag: header, noDrag: [searchField, gear], fullScreen: false
    ))
    #expect(!TitlebarDragView.isDraggable(
        onGear, in: size, drag: header, noDrag: [searchField, gear], fullScreen: false
    ))
}

@Test @MainActor func belowTheHeaderIsNeverDraggable() {
    let size = NSSize(width: 1200, height: 800)
    let point = NSPoint(x: 300, y: size.height - 400)
    #expect(!TitlebarDragView.isDraggable(
        point, in: size, drag: header, noDrag: [], fullScreen: false
    ))
}

@Test @MainActor func fullscreenDragsNothing() {
    let size = NSSize(width: 1200, height: 800)
    let point = NSPoint(x: 300, y: size.height - 26)
    #expect(!TitlebarDragView.isDraggable(
        point, in: size, drag: header, noDrag: [], fullScreen: true
    ))
}

@Test @MainActor func beforeThePageReportsAnythingTheHeuristicStripStillDrags() {
    let size = NSSize(width: 1200, height: 800)
    #expect(TitlebarDragView.isDraggable(
        NSPoint(x: 600, y: size.height - 4), in: size, drag: .zero, noDrag: [], fullScreen: false
    ))
    #expect(TitlebarDragView.isDraggable(
        NSPoint(x: 40, y: size.height - 40), in: size, drag: .zero, noDrag: [], fullScreen: false
    ))
    #expect(!TitlebarDragView.isDraggable(
        NSPoint(x: 600, y: size.height - 40), in: size, drag: .zero, noDrag: [], fullScreen: false
    ))
}

// Fastmail's own app draws a 52-point header and sets its window buttons into
// it; ours kept the standard title bar, which left them nine points high and
// ten points left of the icons beside them. Measured against an untouched
// window rather than against fixed numbers, since the exact metrics are
// AppKit's to choose.
@MainActor
private func closeButtonPlacement(_ window: NSWindow) -> (x: CGFloat, fromTop: CGFloat)? {
    window.layoutIfNeeded()
    guard
        let close = window.standardWindowButton(.closeButton),
        let container = close.superview
    else { return nil }
    let frame = container.convert(close.frame, to: nil)
    return (frame.minX, window.frame.height - frame.maxY)
}

@Test @MainActor func theWindowButtonsSitLowerAndFurtherInThanAPlainTitleBarPutsThem() throws {
    let plain = makeWindow()
    let configured = makeWindow()
    configureWindow(configured)

    let before = try #require(closeButtonPlacement(plain))
    let after = try #require(closeButtonPlacement(configured))

    #expect(after.fromTop > before.fromTop)
    #expect(after.x > before.x)
}

@Test @MainActor func theTitleBarIsGivenItsHeightByAToolbarThatCarriesNothing() {
    let window = makeWindow()
    configureWindow(window)

    #expect(window.toolbarStyle == .unified)
    #expect(window.toolbar != nil)
    #expect(window.toolbar?.items.isEmpty == true)
    // Hiding it puts the buttons back where they were, so it has to stay.
    #expect(window.toolbar?.isVisible == true)
}

// A tab bar is drawn over the page rather than moving it, so without help the
// page keeps its full height and the bar hides a strip of it — Fastmail's list
// toolbar, as it happens — with a sliver of page showing above.

@Test @MainActor func aWindowWithoutTabsLeavesThePageAlone() {
    let window = makeWindow()
    configureWindow(window)
    // The chrome does cover the top of the page: that is the design, and the
    // header is meant to show through it.
    #expect(contentTopInset(of: window) > 0)
    // But nothing is pushed down until a tab bar is actually there.
    #expect(tabbedPageInset(of: window) == 0)
}

@Test @MainActor func theScriptMovesOnlyWhatSitsBelowTheHeader() {
    let showing = tabInsetScript(visible: true, barTop: 66, barBottom: 94)
    #expect(showing.contains("add('fmshell-tabbed')"))
    // Both edges are measured in the page: the header, which is what moves,
    // and the search box, which sets how much air the bar gets.
    #expect(showing.contains("v-PageHeader"))
    #expect(showing.contains("searchBottom"))
    // The room above the bar, and the room below it, are the same measurement.
    #expect(showing.contains("66-searchBottom"))
    #expect(showing.contains("94-header+above"))

    let gone = tabInsetScript(visible: false, barTop: 0, barBottom: 0)
    #expect(gone.contains("remove('fmshell-tabbed')"))
    #expect(!gone.contains("v-PageHeader"))
}

// New Tab opens a window and folds it into the one in front. Which window
// appeared has to be worked out after the fact, since opening one hands back
// nothing, and a compose window opening at the same moment must not be
// mistaken for it — those refuse to be tabs.

@Test @MainActor func theWindowThatAppearedIsTheOneThatCanBeATab() {
    let existing = makeWindow()
    let compose = makeWindow()
    compose.tabbingMode = .disallowed
    let fresh = makeWindow()

    let picked = ShellWindows.opened(before: [existing], after: [existing, compose, fresh])
    #expect(picked === fresh)
}

@Test @MainActor func nothingIsPickedWhenNoWindowAppeared() {
    let existing = makeWindow()
    #expect(ShellWindows.opened(before: [existing], after: [existing]) == nil)
}

@Test @MainActor func aWindowThatRefusesTabsIsNeverPicked() {
    let existing = makeWindow()
    let compose = makeWindow()
    compose.tabbingMode = .disallowed
    #expect(ShellWindows.opened(before: [existing], after: [existing, compose]) == nil)
}

// Both edges of the tab bar come from what the window reports, so every tab
// works them out the same way. Reading one of them off a spell without a tab
// bar meant a window born into a group had never seen one, and its page lost
// the air above the bar that its neighbours had.
@Test @MainActor func theBarsEdgesDoNotDependOnWhatAWindowHasSeen() {
    let edges = tabBarEdges(contentInset: 102)
    #expect(edges?.top == 66)
    #expect(edges?.bottom == 94)
}

@Test @MainActor func thereAreNoEdgesWithoutABar() {
    #expect(tabBarEdges(contentInset: 0) == nil)
}

#endif
