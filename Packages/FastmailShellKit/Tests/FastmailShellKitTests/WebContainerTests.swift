import Testing
import WebKit
@testable import FastmailShellKit

private struct StubLoader: ResourceLoading {
    var resources: [String: String]
    func string(named name: String) -> String? { resources[name] }
}

private let nonMatchingHeader = """
// ==UserScript==
// @match https://app.fastmail.com/*
// @run-at document-idle
// ==/UserScript==
"""

@Test @MainActor func makeWebViewShowsBannerWhenConfigTimeMatchFails() async throws {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": nonMatchingHeader + "\nBODY"
    ])
    let model = ShellModel()
    let profile = Profile(
        id: "test",
        displayName: "Test",
        startURL: URL(string: "about:blank")!,
        overlayScriptName: nil,
        urlScheme: "test",
        accountID: nil
    )
    let container = WebContainer(profile: profile, model: model, loader: loader)
    let coordinator = WebCoordinator(model: model, startURL: profile.startURL)
    let webView = container.makeWebView(coordinator: coordinator)
    // Settings bootstrap + harness; the non-matching userscript stays out
    #expect(webView.configuration.userContentController.userScripts.count == 2)
    var attempts = 0
    while model.banner == nil && attempts < 50 {
        await Task.yield()
        attempts += 1
    }
    #expect(model.banner == "User script @match does not cover \(profile.startURL.absoluteString)")
}

@Test @MainActor func makeWebViewLeavesBannerNilWhenConfigTimeMatchSucceeds() throws {
    let matchingHeader = """
    // ==UserScript==
    // @match about:blank
    // @run-at document-idle
    // ==/UserScript==
    """
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": matchingHeader + "\nBODY"
    ])
    let model = ShellModel()
    let profile = Profile(
        id: "test",
        displayName: "Test",
        startURL: URL(string: "about:blank")!,
        overlayScriptName: nil,
        urlScheme: "test",
        accountID: nil
    )
    let container = WebContainer(profile: profile, model: model, loader: loader)
    let coordinator = WebCoordinator(model: model, startURL: profile.startURL)
    let webView = container.makeWebView(coordinator: coordinator)
    // Settings bootstrap + harness + the matching userscript
    #expect(webView.configuration.userContentController.userScripts.count == 3)
    #expect(model.banner == nil)
    let first = webView.configuration.userContentController.userScripts[0]
    #expect(first.source.hasPrefix("window.__fastmailCustomSettings = {"))
}

@Test @MainActor func loadURLDefaultsToTheProfileStartURL() {
    let profile = Profile.personal(accountID: nil)
    let container = WebContainer(
        profile: profile, model: ShellModel(), loader: StubLoader(resources: [:])
    )
    #expect(container.loadURL == profile.startURL)
}

@Test @MainActor func makeWebViewLoadsTheSuppliedURLNotTheProfileDefault() async throws {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": nonMatchingHeader + "\nBODY"
    ])
    let model = ShellModel()
    let profile = Profile(
        id: "test",
        displayName: "Test",
        startURL: URL(string: "https://127.0.0.1:1/default")!,
        overlayScriptName: nil,
        urlScheme: "test",
        accountID: nil
    )
    let chosen = URL(string: "https://127.0.0.1:1/chosen")!
    #expect(chosen != profile.startURL)
    let container = WebContainer(profile: profile, model: model, loader: loader, loadURL: chosen)
    let coordinator = WebCoordinator(model: model, startURL: chosen)
    let webView = container.makeWebView(coordinator: coordinator)
    #expect(container.loadURL == chosen)
    var attempts = 0
    while webView.url == nil && attempts < 50 {
        try await Task.sleep(for: .milliseconds(20))
        attempts += 1
    }
    #expect(webView.url == chosen)
}

// An iPad's default is desktop-class browsing, which makes Fastmail serve the
// wide layout in a shell built for the touch one.
@Test @MainActor func theWebViewCarriesThePlatformsContentMode() {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": nonMatchingHeader + "\nBODY"
    ])
    let model = ShellModel()
    let profile = Profile(
        id: "test",
        displayName: "Test",
        startURL: URL(string: "https://127.0.0.1:1/")!,
        overlayScriptName: nil,
        urlScheme: "test",
        accountID: nil
    )
    let container = WebContainer(profile: profile, model: model, loader: loader)
    let coordinator = WebCoordinator(model: model, startURL: profile.startURL)
    let webView = container.makeWebView(coordinator: coordinator)

    #expect(webView.configuration.defaultWebpagePreferences.preferredContentMode
        == WebContainer.preferredContentMode)

    #if os(iOS)
    #expect(WebContainer.preferredContentMode == .mobile)
    #else
    #expect(WebContainer.preferredContentMode == .recommended)
    #endif
}

#if os(macOS)
// The remote debugging switch is the phone's; the Mac's views stay inspectable.
@Test @MainActor func theMacsMainWebViewStaysInspectable() {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": nonMatchingHeader + "\nBODY"
    ])
    let model = ShellModel()
    let profile = Profile(
        id: "test",
        displayName: "Test",
        startURL: URL(string: "https://127.0.0.1:1/")!,
        overlayScriptName: nil,
        urlScheme: "test",
        accountID: nil
    )
    let container = WebContainer(profile: profile, model: model, loader: loader)
    let coordinator = WebCoordinator(model: model, startURL: profile.startURL)
    let webView = container.makeWebView(coordinator: coordinator)
    #expect(webView.isInspectable)
}
#endif

// Handoff offers whatever the window is showing, so the model has to keep up
// with a page Fastmail swaps in without a load.
@Test @MainActor func theModelFollowsThePageTheWindowIsShowing() async throws {
    let model = ShellModel()
    let webView = WKWebView(frame: .zero)
    let watcher = PageWatcher(model: model, webView: webView)
    webView.loadHTMLString(
        "<html><body>hi</body></html>",
        baseURL: URL(string: "https://app.fastmail.com/mail/Inbox")!
    )
    var waited = 0
    while model.pageURL == nil, waited < 100 {
        try await Task.sleep(for: .milliseconds(50))
        waited += 1
    }
    #expect(model.pageURL?.absoluteString == "https://app.fastmail.com/mail/Inbox")
    withExtendedLifetime(watcher) {}
}

// A link that lands on the page already open is a step inside it. Fastmail
// swaps the view for a pushed address, which is what clicking a link in the
// page does; loading it afresh throws the whole app away and rebuilds it.
@Test func aLinkOnTheSameSiteIsAStepInsideThePage() {
    #expect(
        LinkLoader.step(
            from: URL(string: "https://app.fastmail.com/mail/Inbox/?u=a1"),
            to: URL(string: "https://app.fastmail.com/mail/Archive/T7?u=a1")!
        ) == "/mail/Archive/T7?u=a1"
    )
    #expect(
        LinkLoader.step(
            from: URL(string: "https://app.beta.fastmail.com/mail/Inbox/"),
            to: URL(string: "https://app.beta.fastmail.com/mail/Inbox/T7#reply")!
        ) == "/mail/Inbox/T7#reply"
    )
}

@Test func anythingElseIsLoaded() {
    // Nothing on screen yet, so there is no page to steer.
    #expect(LinkLoader.step(from: nil, to: URL(string: "https://app.fastmail.com/mail/Inbox/")!) == nil)
    #expect(
        LinkLoader.step(
            from: URL(string: "about:blank"),
            to: URL(string: "https://app.fastmail.com/mail/Inbox/")!
        ) == nil
    )
    // The other server is a different app entirely.
    #expect(
        LinkLoader.step(
            from: URL(string: "https://app.fastmail.com/mail/Inbox/"),
            to: URL(string: "https://app.beta.fastmail.com/mail/Inbox/")!
        ) == nil
    )
    // A message to write is handed over whole, as it always was.
    #expect(
        LinkLoader.step(
            from: URL(string: "https://app.fastmail.com/mail/Inbox/"),
            to: URL(string: "https://app.fastmail.com/mail/compose?mailto=mailto:a@b.com&u=a1")!
        ) == nil
    )
}

// Tests install no sync component, and neither does the Mailto app: such a
// page is told nothing about syncing, so it draws no switch
@Test @MainActor func withoutASyncComponentThePageIsToldNothingAboutSync() {
    #expect(FastmailCustomSettingsSync.current == nil)
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": nonMatchingHeader + "\nBODY"
    ])
    let model = ShellModel()
    let profile = Profile(
        id: "test",
        displayName: "Test",
        startURL: URL(string: "https://127.0.0.1:1/")!,
        overlayScriptName: nil,
        urlScheme: "test",
        accountID: nil
    )
    let container = WebContainer(profile: profile, model: model, loader: loader)
    let coordinator = WebCoordinator(model: model, startURL: profile.startURL)
    let webView = container.makeWebView(coordinator: coordinator)
    let bootstrap = webView.configuration.userContentController.userScripts[0]
    #expect(bootstrap.source.hasPrefix("window.__fastmailCustomSettings = {"))
    #expect(!bootstrap.source.contains("__fastmailCustomSync"))
}
