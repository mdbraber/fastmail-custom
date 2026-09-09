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
    #expect(first.source.hasPrefix("window.__customModeSettings = {"))
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
