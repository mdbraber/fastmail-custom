#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import Foundation
import Testing
@testable import FastmailShellKit

@Test func aMailWindowIsMainWhateverItShows() {
    let url = URL(string: "https://app.fastmail.com/mail/Inbox/compose?u=1")
    #expect(ScriptWindowKind.of(isMailWindow: true, hasPage: true, url: url) == .main)
}

@Test func aComposePageIsKnownByItsPath() {
    let pooled = URL(string: "https://app.fastmail.com/mail/Inbox/compose?u=1&ui=minimal")
    let draft = URL(string: "https://app.fastmail.com/mail/compose/Mabc?mode=draft")
    #expect(ScriptWindowKind.of(isMailWindow: false, hasPage: true, url: pooled) == .compose)
    #expect(ScriptWindowKind.of(isMailWindow: false, hasPage: true, url: draft) == .compose)
}

@Test func anyOtherPageIsAPopOut() {
    let message = URL(string: "https://app.fastmail.com/mail/Inbox/Mabc?ui=minimal")
    let composer = URL(string: "https://app.fastmail.com/mail/Inbox/Mcomposer")
    #expect(ScriptWindowKind.of(isMailWindow: false, hasPage: true, url: message) == .popOut)
    #expect(ScriptWindowKind.of(isMailWindow: false, hasPage: true, url: composer) == .popOut)
}

@Test func aWindowWithNoPageIsOther() {
    #expect(ScriptWindowKind.of(isMailWindow: false, hasPage: false, url: nil) == .other)
}

@Test func theCodesMatchTheDictionary() {
    #expect(ScriptWindowKind.main.code == 0x464B_6D61)
    let sdef = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Apps/Shared/Fastmail.sdef")
    let text = (try? String(contentsOf: sdef, encoding: .utf8)) ?? ""
    for (kind, code) in [(ScriptWindowKind.main, "FKma"), (.popOut, "FKpo"), (.compose, "FKco"), (.other, "FKot")] {
        let bytes = code.utf8.reduce(FourCharCode(0)) { $0 << 8 | FourCharCode($1) }
        #expect(kind.code == bytes)
        #expect(text.contains("code=\"\(code)\""))
    }
}
#endif
