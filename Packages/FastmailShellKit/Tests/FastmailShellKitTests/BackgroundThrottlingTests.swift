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
#endif
