import Testing
import WebKit
@testable import FastmailShellKit

#if canImport(AppKit)
import AppKit
#endif

@Test @MainActor func registrationHoldsViewsWithoutDuplicates() {
    let registry = WebViewRegistry()
    let first = WKWebView()
    let second = WKWebView()
    registry.register(first)
    registry.register(first)
    registry.register(second)
    #expect(registry.views == [first, second])
}

@Test @MainActor func aDeallocatedViewDropsOutOfTheRegistry() {
    let registry = WebViewRegistry()
    autoreleasepool {
        var doomed: WKWebView? = WKWebView()
        registry.register(doomed!)
        #expect(registry.views.count == 1)
        doomed = nil
    }
    #expect(registry.views.isEmpty)
    #expect(registry.active == nil)
}

#if canImport(AppKit)
@Test @MainActor func resolutionFollowsTheKeyWindowThenMainThenFirst() {
    let firstWindow = NSWindow(
        contentRect: .zero, styleMask: [.titled], backing: .buffered, defer: true
    )
    let secondWindow = NSWindow(
        contentRect: .zero, styleMask: [.titled], backing: .buffered, defer: true
    )
    firstWindow.isReleasedWhenClosed = false
    secondWindow.isReleasedWhenClosed = false
    let firstView = WKWebView()
    let secondView = WKWebView()
    firstWindow.contentView = firstView
    secondWindow.contentView = secondView
    let views = [firstView, secondView]

    #expect(WebViewRegistry.resolve(views: views, keyWindow: secondWindow, mainWindow: nil) == secondView)
    #expect(WebViewRegistry.resolve(views: views, keyWindow: nil, mainWindow: secondWindow) == secondView)
    #expect(WebViewRegistry.resolve(views: views, keyWindow: nil, mainWindow: nil) == firstView)
    #expect(WebViewRegistry.resolve(views: [], keyWindow: firstWindow, mainWindow: nil) == nil)
}
#endif
