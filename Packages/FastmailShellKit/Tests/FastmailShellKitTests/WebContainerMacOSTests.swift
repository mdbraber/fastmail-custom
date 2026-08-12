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

@Test @MainActor func observeFullScreenRegistersOneObserverPerWindow() throws {
    let window = makeWindow()
    let webView = WKWebView()
    #expect(fullScreenObservers[ObjectIdentifier(window)] == nil)
    observeFullScreen(window, webView: webView)
    #expect(fullScreenObservers[ObjectIdentifier(window)] != nil)
}

@Test @MainActor func observeFullScreenTearsDownObserversWhenWindowCloses() throws {
    let window = makeWindow()
    let webView = WKWebView()
    observeFullScreen(window, webView: webView)
    #expect(fullScreenObservers[ObjectIdentifier(window)] != nil)
    NotificationCenter.default.post(name: NSWindow.willCloseNotification, object: window)
    #expect(fullScreenObservers[ObjectIdentifier(window)] == nil)
}

@Test @MainActor func observeFullScreenReplacesAnExistingObserverForTheSameWindow() throws {
    let window = makeWindow()
    let webView = WKWebView()
    observeFullScreen(window, webView: webView)
    let first = try #require(fullScreenObservers[ObjectIdentifier(window)])
    observeFullScreen(window, webView: webView)
    let second = try #require(fullScreenObservers[ObjectIdentifier(window)])
    #expect(first !== second)
}
#endif
