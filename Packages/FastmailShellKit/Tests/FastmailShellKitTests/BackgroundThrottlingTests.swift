#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import Testing
import WebKit
@testable import FastmailShellKit

@Test @MainActor func theMailPageIsNotSuspendedInTheBackground() {
    let preferences = WKPreferences()
    #expect(BackgroundThrottling.keepRunning(preferences))

    let features = (WKPreferences.self as AnyObject)
        .perform(Selector(("_features")))?.takeUnretainedValue() as? [NSObject] ?? []
    let feature = features.first {
        ($0.perform(Selector(("key")))?.takeUnretainedValue() as? String) == BackgroundThrottling.featureKey
    }
    let isEnabled = Selector(("_isEnabledForFeature:"))
    guard let feature, let method = class_getInstanceMethod(WKPreferences.self, isEnabled) else {
        Issue.record("WebKit no longer has the feature")
        return
    }
    typealias Getter = @convention(c) (AnyObject, Selector, AnyObject) -> Bool
    let get = unsafeBitCast(method_getImplementation(method), to: Getter.self)
    #expect(get(preferences, isEnabled, feature) == false)
    #expect(get(WKPreferences(), isEnabled, feature) == true)
}

@Test @MainActor func aCoveredMailWindowStillCountsAsSeen() {
    let view = WKWebView()
    #expect(BackgroundThrottling.ignoreCovering(view))
    let getter = Selector(("_windowOcclusionDetectionEnabled"))
    guard let method = class_getInstanceMethod(WKWebView.self, getter) else {
        Issue.record("WebKit no longer has the setting")
        return
    }
    typealias Getter = @convention(c) (AnyObject, Selector) -> Bool
    let get = unsafeBitCast(method_getImplementation(method), to: Getter.self)
    #expect(get(view, getter) == false)
    #expect(get(WKWebView(), getter) == true)
}

@Test @MainActor func theMailPageKeepsItsPriorityInTheBackground() {
    let preferences = WKPreferences()
    #expect(BackgroundThrottling.keepPriority(preferences))
    let getter = Selector(("_pageVisibilityBasedProcessSuppressionEnabled"))
    guard let method = class_getInstanceMethod(WKPreferences.self, getter) else {
        Issue.record("WebKit no longer has the setting")
        return
    }
    typealias Getter = @convention(c) (AnyObject, Selector) -> Bool
    let get = unsafeBitCast(method_getImplementation(method), to: Getter.self)
    #expect(get(preferences, getter) == false)
    #expect(get(WKPreferences(), getter) == true)
}

@Test @MainActor func aHiddenAppKeepsAWindowTheMailPageSharesItsProcessWith() {
    let mail = WKWebView()
    let company = BackgroundCompany()
    #expect(company.keep(mail))
    guard let window = company.window, let view = window.contentView as? WKWebView else {
        Issue.record("No window was made")
        return
    }
    #expect(window.canHide == false)
    #expect(window.isVisible)
    #expect(window.ignoresMouseEvents)
    #expect(window.canBecomeKey == false)
    #expect(window.canBecomeMain == false)
    let related = view.configuration.perform(Selector(("_relatedWebView")))?.takeUnretainedValue()
    #expect(related === mail)
    // One window for the app, however many mail windows ask
    #expect(company.keep(WKWebView()))
    #expect(company.window === window)
    #expect(WindowFocus.isOnScreen(window) == false)
    window.orderOut(nil)
    window.close()
}

@Test func aDockClickLooksPastTheCompanyWindow() {
    // A window of the user's is in sight: the system's own answer stands
    #expect(DockClick.answer(othersInSight: true, minimised: false, closed: false) == .asUsual)
    #expect(DockClick.answer(othersInSight: true, minimised: true, closed: true) == .asUsual)
    // Only the company window is, and the system took it for one of theirs
    #expect(DockClick.answer(othersInSight: false, minimised: true, closed: true) == .bringBack)
    #expect(DockClick.answer(othersInSight: false, minimised: false, closed: true) == .showAgain)
    #expect(
        DockClick.answer(othersInSight: false, minimised: false, closed: false)
            == .askAgainWithoutCompany
    )
}

@Test func onlyTheLastMailWindowIsKeptWhenClosed() {
    #expect(ClosedWindowKeeper.keeps(otherMailWindowsOpen: 0, fullScreen: false))
    // Another mail window carries on taking in mail
    #expect(ClosedWindowKeeper.keeps(otherMailWindowsOpen: 1, fullScreen: false) == false)
    // A full screen window has a space of its own to give back
    #expect(ClosedWindowKeeper.keeps(otherMailWindowsOpen: 0, fullScreen: true) == false)
}

@MainActor private final class WindowDelegateStub: NSObject, NSWindowDelegate {
    var resized = 0
    var closed = 0
    func windowDidResize(_ notification: Notification) { resized += 1 }
    func windowWillClose(_ notification: Notification) { closed += 1 }
}

@Test @MainActor func aClosedMailWindowGoesOutOfSightWithItsPage() {
    let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 200, height: 200),
        styleMask: [.titled, .closable], backing: .buffered, defer: false
    )
    window.isReleasedWhenClosed = false
    // Not one for the tests that fold windows into tabs to pick up
    window.tabbingMode = .disallowed
    let view = WKWebView()
    window.contentView = view
    let theirs = WindowDelegateStub()
    window.delegate = theirs
    ClosedWindowKeeper.watch(window, otherMailWindowsOpen: { 0 })
    // Putting it in twice changes nothing
    ClosedWindowKeeper.watch(window, otherMailWindowsOpen: { 0 })
    window.orderFront(nil)

    window.performClose(nil)
    #expect(window.isVisible == false)
    #expect(theirs.closed == 0)
    #expect(view.window === window)

    // Whatever else the window has to say still reaches its own delegate
    window.setContentSize(NSSize(width: 300, height: 300))
    #expect(theirs.resized > 0)
    window.delegate = nil
    window.close()
}

@Test @MainActor func aNewWindowIsTheOneKeptOutOfSight() {
    func window() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 200, height: 200),
            styleMask: [.titled, .closable], backing: .buffered, defer: false
        )
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        return window
    }
    let shown = window()
    let kept = window()
    shown.orderFront(nil)
    #expect(ClosedWindowKeeper.kept(among: [shown, kept]) === kept)
    #expect(ClosedWindowKeeper.kept(among: [shown]) == nil)
    #expect(ClosedWindowKeeper.kept(among: []) == nil)
    shown.close()
}
#endif
