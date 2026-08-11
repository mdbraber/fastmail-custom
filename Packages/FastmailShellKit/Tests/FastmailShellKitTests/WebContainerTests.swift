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

@Test @MainActor func makeWebViewShowsBannerWhenConfigTimeMatchFails() throws {
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
    #expect(webView.configuration.userContentController.userScripts.count == 1)
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
    #expect(webView.configuration.userContentController.userScripts.count == 2)
    #expect(model.banner == nil)
}
