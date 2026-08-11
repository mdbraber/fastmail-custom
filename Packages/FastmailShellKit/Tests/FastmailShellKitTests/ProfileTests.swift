import Testing
import Foundation
@testable import FastmailShellKit

@Test func personalProfileHasExpectedIdentity() {
    let profile = Profile.personal(accountID: nil)
    #expect(profile.id == "personal")
    #expect(profile.displayName == "mdbraber.com")
    #expect(profile.urlScheme == "fastmail-personal")
    #expect(profile.overlayScriptName == "userscript.personal.js")
    #expect(profile.startURL.absoluteString == "https://app.fastmail.com/")
}

@Test func workProfileHasExpectedIdentity() {
    let profile = Profile.work(accountID: nil)
    #expect(profile.id == "work")
    #expect(profile.displayName == "nexthealth.nl")
    #expect(profile.urlScheme == "fastmail-work")
    #expect(profile.overlayScriptName == "userscript.work.js")
}

@Test func accountIDIsCarriedThrough() {
    #expect(Profile.personal(accountID: "abc123").accountID == "abc123")
}

@Test func unsubstitutedBuildSettingIsTreatedAsAbsent() {
    #expect(Profile.normalizedAccountID("$(PERSONAL_ACCOUNT_ID)") == nil)
    #expect(Profile.normalizedAccountID("") == nil)
    #expect(Profile.normalizedAccountID("   ") == nil)
    #expect(Profile.normalizedAccountID("abc123") == "abc123")
}
