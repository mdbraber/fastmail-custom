import Foundation
import Testing
import WebKit
@testable import FastmailShellKit

@Test func onThePhoneTheSwitchDecidesWhetherTheInspectorMayAttach() {
    #expect(WebInspection.isAllowed(isMac: false, remoteDebugging: true))
    #expect(!WebInspection.isAllowed(isMac: false, remoteDebugging: false))
}

@Test func theMacsWebViewsStayInspectableWhateverIsStored() {
    #expect(WebInspection.isAllowed(isMac: true, remoteDebugging: true))
    #expect(WebInspection.isAllowed(isMac: true, remoteDebugging: false))
}

#if os(macOS)
@Test @MainActor func onTheMacApplyingTheSwitchLeavesViewsInspectable() {
    let suite = "web-inspection-mac-test"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    defaults.set(false, forKey: DevicePreferences.remoteDebuggingKey)
    let view = WKWebView()
    view.isInspectable = false
    WebInspection.apply(to: [view], in: defaults)
    #expect(view.isInspectable)
    defaults.removePersistentDomain(forName: suite)
}
#endif
