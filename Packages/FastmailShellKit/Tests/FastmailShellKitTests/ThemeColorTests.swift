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

@Test func judgesLightnessByLuminance() {
    #expect(ThemeColor.isDark((0, 0, 0)))
    #expect(!ThemeColor.isDark((1, 1, 1)))
    #expect(!ThemeColor.isDark((214.0 / 255, 216.0 / 255, 218.0 / 255)))
    #expect(ThemeColor.isDark((0.1, 0.1, 0.12)))
}

@Test func weightsGreenMoreThanBlue() {
    #expect(ThemeColor.isDark((0, 0, 1)))
    #expect(!ThemeColor.isDark((0, 1, 0)))
}
