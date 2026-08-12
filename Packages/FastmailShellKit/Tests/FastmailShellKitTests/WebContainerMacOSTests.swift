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
    model.tint = "#d6d8da"
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
    model.tint = "not-a-color"
    #expect(window.backgroundColor == before)
}

@Test @MainActor func observeFullScreenStopsApplyingTintAfterWindowCloses() throws {
    let window = makeWindow()
    let webView = WKWebView()
    let model = ShellModel()
    observeFullScreen(window, webView: webView, model: model)
    NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: window)
    model.tint = "#000000"
    #expect(window.backgroundColor != NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 1))
}
#endif
