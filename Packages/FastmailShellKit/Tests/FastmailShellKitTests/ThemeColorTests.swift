import Testing
@testable import FastmailShellKit

@Test func parsesSixDigitHex() throws {
    let rgb = try #require(ThemeColor.components(fromHex: "#d6d8da"))
    #expect(abs(rgb.0 - 214.0 / 255.0) < 0.001)
    #expect(abs(rgb.1 - 216.0 / 255.0) < 0.001)
    #expect(abs(rgb.2 - 218.0 / 255.0) < 0.001)
}

@Test func parsesWithoutLeadingHash() {
    #expect(ThemeColor.components(fromHex: "d6d8da") != nil)
}

@Test func parsesThreeDigitShorthand() throws {
    let rgb = try #require(ThemeColor.components(fromHex: "#fff"))
    #expect(rgb.0 == 1.0 && rgb.1 == 1.0 && rgb.2 == 1.0)
}

@Test func rejectsMalformedValues() {
    #expect(ThemeColor.components(fromHex: "") == nil)
    #expect(ThemeColor.components(fromHex: "#12345") == nil)
    #expect(ThemeColor.components(fromHex: "#gggggg") == nil)
    #expect(ThemeColor.components(fromHex: "rgb(1,2,3)") == nil)
}

@Test func parsesFunctionalRGBAsGetComputedStyleReturnsIt() throws {
    let rgb = try #require(ThemeColor.components(from: "rgb(124, 179, 66)"))
    #expect(abs(rgb.0 - 124.0 / 255.0) < 0.001)
    #expect(abs(rgb.1 - 179.0 / 255.0) < 0.001)
    #expect(abs(rgb.2 - 66.0 / 255.0) < 0.001)
}

@Test func parsesOpaqueRGBAAndModernSlashSyntax() throws {
    #expect(ThemeColor.components(from: "rgba(10, 20, 30, 1)") != nil)
    #expect(ThemeColor.components(from: "rgb(10 20 30 / 1)") != nil)
}

@Test func rejectsTransparentSoTheTintFallsBack() {
    #expect(ThemeColor.components(from: "rgba(0, 0, 0, 0)") == nil)
    #expect(ThemeColor.components(from: "rgba(124, 179, 66, 0.5)") == nil)
}

@Test func stillAcceptsHexThroughTheCommonEntryPoint() throws {
    let rgb = try #require(ThemeColor.components(from: "#f4f5f5"))
    #expect(abs(rgb.0 - 244.0 / 255.0) < 0.001)
}

@Test func rejectsMalformedFunctionalValues() {
    #expect(ThemeColor.components(from: "rgb(1, 2)") == nil)
    #expect(ThemeColor.components(from: "rgb(300, 0, 0)") == nil)
    #expect(ThemeColor.components(from: "rgb()") == nil)
    #expect(ThemeColor.components(from: "rgb(a, b, c)") == nil)
}
