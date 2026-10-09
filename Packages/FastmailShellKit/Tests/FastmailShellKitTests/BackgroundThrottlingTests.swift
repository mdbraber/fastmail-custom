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

@Test @MainActor func theAppEndsWithItsLastWindowButNotWithItsLastPanel() {
    func window(shown: Bool) -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 200, height: 200),
            styleMask: [.titled, .closable], backing: .buffered, defer: false
        )
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        if shown { window.orderFront(nil) }
        return window
    }
    // Nothing of the user's: no window, and the compose pool's spare, which
    // waits ordered out of sight for the next message. No app to keep up.
    #expect(DockClick.staysOpen([]) == false)
    #expect(DockClick.staysOpen([window(shown: false)]) == false)
    // One window in sight and the app stays
    let open = window(shown: true)
    #expect(DockClick.staysOpen([window(shown: false), open]))
    // A file picker counts while it is open, and not after
    let panel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 200, height: 200),
        styleMask: [.titled], backing: .buffered, defer: false
    )
    #expect(DockClick.staysOpen([panel]) == false)
    panel.orderFront(nil)
    #expect(DockClick.staysOpen([panel]))
    // Being an NSPanel is not enough: AppKit keeps panels of its own around,
    // invisible, and a tooltip used to hold the app open this way
    let hiddenPanel = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 200, height: 200),
        styleMask: [.titled], backing: .buffered, defer: false
    )
    hiddenPanel.orderOut(nil)
    #expect(DockClick.staysOpen([hiddenPanel]) == false)
    open.close()
    panel.close()
    hiddenPanel.close()
}
#endif
