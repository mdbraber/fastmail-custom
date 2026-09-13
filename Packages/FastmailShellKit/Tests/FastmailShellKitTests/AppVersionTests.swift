import Foundation
import Testing
@testable import FastmailShellKit

@Test func theVersionReadsAsShortVersionThenBuild() {
    #expect(AppVersion.text(short: "1.0", build: "1") == "1.0 (1)")
    #expect(AppVersion.text(short: " 2.3 ", build: " 45 ") == "2.3 (45)")
}

@Test func aMissingHalfLeavesTheOther() {
    #expect(AppVersion.text(short: "1.0", build: nil) == "1.0")
    #expect(AppVersion.text(short: "1.0", build: "") == "1.0")
    #expect(AppVersion.text(short: nil, build: "7") == "7")
    #expect(AppVersion.text(short: "  ", build: "7") == "7")
    #expect(AppVersion.text(short: nil, build: nil) == "Unknown")
}

@Test func theVersionIsReadFromTheInfoDictionaryKeys() {
    let info: [String: Any] = ["CFBundleShortVersionString": "1.0", "CFBundleVersion": "1"]
    #expect(AppVersion.text(infoDictionary: info) == "1.0 (1)")
    #expect(AppVersion.text(infoDictionary: nil) == "Unknown")
}
