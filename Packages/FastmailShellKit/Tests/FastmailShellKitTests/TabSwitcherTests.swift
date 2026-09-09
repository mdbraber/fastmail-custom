#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import Testing
@testable import FastmailShellKit

/// Command and a number is the tab bar's. Option and a number stays the
/// sidebar's, as Custom mode has always had it.
@Test func onlyCommandAloneIsOurs() {
    #expect(TabSwitcher.claims([.command]))
    // A number key reports the numeric keypad too, whichever row it is on.
    #expect(TabSwitcher.claims([.command, .numericPad]))
    #expect(TabSwitcher.claims([.command, .function]))
    #expect(!TabSwitcher.claims([.option]))
    #expect(!TabSwitcher.claims([.command, .option]))
    #expect(!TabSwitcher.claims([.command, .shift]))
    #expect(!TabSwitcher.claims([.command, .control]))
}

@Test func aNumberPicksTheTabAtThatPlace() {
    #expect(TabSwitcher.target(digit: 1, count: 3) == 0)
    #expect(TabSwitcher.target(digit: 3, count: 3) == 2)
}

/// Nine is the last tab wherever it falls, the way a browser has it.
@Test func nineIsTheLastTab() {
    #expect(TabSwitcher.target(digit: 9, count: 3) == 2)
    #expect(TabSwitcher.target(digit: 9, count: 2) == 1)
}

/// A number past the last tab, and a window with no tabs at all, leave the
/// keystroke alone: the page uses those combinations itself.
@Test func anythingElseIsLeftToThePage() {
    #expect(TabSwitcher.target(digit: 5, count: 3) == nil)
    #expect(TabSwitcher.target(digit: 1, count: 1) == nil)
    #expect(TabSwitcher.target(digit: 1, count: 0) == nil)
}

@Test func onlyASingleDigitCounts() {
    #expect(TabSwitcher.digit(from: "4") == 4)
    #expect(TabSwitcher.digit(from: "0") == nil)
    #expect(TabSwitcher.digit(from: "12") == nil)
    #expect(TabSwitcher.digit(from: "t") == nil)
    #expect(TabSwitcher.digit(from: nil) == nil)
}
#endif
