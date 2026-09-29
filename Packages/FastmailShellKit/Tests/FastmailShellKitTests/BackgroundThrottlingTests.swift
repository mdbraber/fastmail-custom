#if canImport(AppKit) && !targetEnvironment(macCatalyst)
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
#endif
