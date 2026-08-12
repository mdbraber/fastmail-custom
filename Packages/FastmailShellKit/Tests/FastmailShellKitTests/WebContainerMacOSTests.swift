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

@Test @MainActor func topStripIsDraggableAcrossTheFullWidth() {
    let size = NSSize(width: 1200, height: 800)
    #expect(TitlebarDragView.isDraggable(NSPoint(x: 600, y: 795), in: size, fullScreen: false))
    #expect(TitlebarDragView.isDraggable(NSPoint(x: 1190, y: 792), in: size, fullScreen: false))
}

@Test @MainActor func theTrafficLightInsetIsDraggableForTheFullTitlebarHeight() {
    let size = NSSize(width: 1200, height: 800)
    #expect(TitlebarDragView.isDraggable(NSPoint(x: 40, y: 760), in: size, fullScreen: false))
    #expect(TitlebarDragView.isDraggable(NSPoint(x: 78, y: 750), in: size, fullScreen: false))
}

@Test @MainActor func fastmailsOwnControlsStayClickable() {
    let size = NSSize(width: 1200, height: 800)
    #expect(!TitlebarDragView.isDraggable(NSPoint(x: 600, y: 770), in: size, fullScreen: false))
    #expect(!TitlebarDragView.isDraggable(NSPoint(x: 1100, y: 765), in: size, fullScreen: false))
    #expect(!TitlebarDragView.isDraggable(NSPoint(x: 600, y: 400), in: size, fullScreen: false))
}

@Test @MainActor func nothingIsDraggableInFullscreenWhereThereIsNoTitlebar() {
    let size = NSSize(width: 1200, height: 800)
    #expect(!TitlebarDragView.isDraggable(NSPoint(x: 600, y: 795), in: size, fullScreen: true))
    #expect(!TitlebarDragView.isDraggable(NSPoint(x: 40, y: 760), in: size, fullScreen: true))
}
#endif
