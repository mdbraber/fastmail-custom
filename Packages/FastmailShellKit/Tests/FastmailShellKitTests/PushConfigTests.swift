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
