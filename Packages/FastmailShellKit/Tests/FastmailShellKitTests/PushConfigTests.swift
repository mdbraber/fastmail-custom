import Foundation
import Testing
@testable import FastmailShellKit

@Test func aHostAndSecretMakeAConfig() {
    let config = PushConfig(host: "push.example.net", secret: "s3cret")
    #expect(config?.server.absoluteString == "https://push.example.net")
    #expect(config?.secret == "s3cret")
}

@Test func aPathAfterTheHostIsKept() {
    #expect(PushConfig(host: "push.example.net/fastmail-push", secret: "s")?.server.absoluteString == "https://push.example.net/fastmail-push")
}

@Test func anUnconfiguredBuildHasNoPush() {
    #expect(PushConfig(host: nil, secret: nil) == nil)
    #expect(PushConfig(host: "", secret: "s") == nil)
    #expect(PushConfig(host: "$(PUSH_SERVER_HOST)", secret: "s") == nil)
    #expect(PushConfig(host: "replace-me", secret: "s") == nil)
    #expect(PushConfig(host: "push.example.net", secret: "") == nil)
    #expect(PushConfig(host: "push.example.net", secret: "$(PUSH_DEVICE_SECRET)") == nil)
    #expect(PushConfig(host: "push.example.net", secret: "replace-me") == nil)
}

@Test func aSchemeInTheHostIsRefused() {
    #expect(PushConfig(host: "https://push.example.net", secret: "s") == nil)
    #expect(PushConfig(host: "http://push.example.net", secret: "s") == nil)
}

@Test func theAccountIsTheBundleIdentifiersLastPart() {
    #expect(PushConfig.account(forBundleIdentifier: "com.mdbraber.fastmail.personal") == "personal")
    #expect(PushConfig.account(forBundleIdentifier: "com.mdbraber.fastmail.work") == "work")
    #expect(PushConfig.account(forBundleIdentifier: "com.mdbraber.fastmail.personal.share") == nil)
    #expect(PushConfig.account(forBundleIdentifier: nil) == nil)
}

@Test func theRegistrationPostsTheHexTokenWithTheSecret() throws {
    let config = try #require(PushConfig(host: "push.example.net/base", secret: "s3cret"))
    let request = config.registration(account: "work", deviceToken: Data([0x00, 0xAB, 0xFF]))
    #expect(request.url?.absoluteString == "https://push.example.net/base/devices")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer s3cret")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    let body = try #require(request.httpBody)
    let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect(json["account"] as? String == "work")
    #expect(json["token"] as? String == "00abff")
    #expect(json["alerts"] as? Bool == true, "alerts are on unless the app says otherwise")
    #expect(json.count == 3)
}

@Test func theRegistrationCarriesTheAlertsSwitch() throws {
    let config = try #require(PushConfig(host: "push.example.net", secret: "s3cret"))
    let request = config.registration(account: "personal", deviceToken: Data([0x01]), alerts: false)
    let body = try #require(request.httpBody)
    let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect(json["alerts"] as? Bool == false)
    #expect(json["token"] as? String == "01")
}

// The Archive button asks the push server to do the work: the phone holds no
// Fastmail credentials, and a background action has seconds rather than the
// time a whole sign-in would take. It vouches for itself with the same secret
// it registers with, since it is the same device.
@Test func theArchiveRequestNamesTheMessageAndCarriesTheSecret() throws {
    let config = try #require(PushConfig(host: "push.example.net/base", secret: "s3cret"))
    let request = config.action("archive", account: "personal", emailId: "M1")

    #expect(request.url?.absoluteString == "https://push.example.net/base/actions")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer s3cret")

    let body = try #require(request.httpBody)
    let sent = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect(sent["account"] as? String == "personal")
    #expect(sent["action"] as? String == "archive")
    #expect(sent["emailId"] as? String == "M1")
}

// The name has to be the one the server sends and the one the app registers
// its buttons under; a category iOS does not know draws no buttons at all.
@Test func theNotificationCategoryIsTheOneTheServerSends() {
    #expect(PushActions.category == "message")
    #expect(PushActions.archive == "archive")
}
