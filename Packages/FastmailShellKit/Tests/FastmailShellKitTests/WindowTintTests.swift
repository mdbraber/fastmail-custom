#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import Testing
import AppKit
@testable import FastmailShellKit

// The window's light-or-dark trim follows what Fastmail says its theme is,
// never what colour happens to be under the sampler.

@Test @MainActor func theWindowFollowsFastmailsOwnDarkTheme() {
    let window = NSWindow()
    applyTint("rgb(28, 28, 30)", isDark: true, to: window)
    #expect(window.appearance?.name == .darkAqua)
}

@Test @MainActor func aLightThemeIsLightHoweverDarkItsHeaderMeasures() {
    let window = NSWindow()
    // The Work account's header. Luminance says dark; Fastmail says otherwise.
    applyTint("rgb(0, 153, 216)", isDark: false, to: window)
    #expect(window.appearance?.name == .aqua)
}

@Test @MainActor func aPageWithNoThemeToAskLeavesTheAppearanceAlone() {
    let window = NSWindow()
    window.appearance = NSAppearance(named: .aqua)
    // Fastmail's log-in screen: navy, and no theme object to ask.
    applyTint("rgb(36, 57, 89)", isDark: nil, to: window)
    #expect(window.appearance?.name == .aqua)
}

@Test @MainActor func theBackgroundIsStillPaintedWhenTheThemeIsUnknown() {
    let window = NSWindow()
    applyTint("rgb(36, 57, 89)", isDark: nil, to: window)
    let painted = window.backgroundColor.usingColorSpace(.sRGB)
    #expect(painted.map { Int(($0.blueComponent * 255).rounded()) } == 89)
}

@Test @MainActor func anUnreadableColourChangesNothing() {
    let window = NSWindow()
    window.appearance = NSAppearance(named: .aqua)
    applyTint("not a colour", isDark: true, to: window)
    #expect(window.appearance?.name == .aqua)
}
#endif
