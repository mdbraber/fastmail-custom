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
    #expect(PushConfig.account(forBundleIdentifier: "com.mdbraber.fastmail-custom.personal") == "personal")
    #expect(PushConfig.account(forBundleIdentifier: "com.mdbraber.fastmail-custom.work") == "work")
    #expect(PushConfig.account(forBundleIdentifier: "com.mdbraber.fastmail-custom.personal.share") == nil)
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
    #expect(json["alerts"] as? Bool == true, "inbox alerts unless the app says otherwise")
    let notify = try #require(json["notify"] as? [String: Any])
    #expect(notify["mode"] as? String == "inbox")
    #expect(notify["senders"] as? String == "everyone")
    #expect(notify["mailboxIds"] as? [String] == [])
    #expect(json.count == 4)
}

// notify is the choice; alerts says the same as on or off, for a server that
// predates notify and reads only alerts
@Test func theRegistrationCarriesTheChoiceAndItsOnOffForOlderServers() throws {
    let config = try #require(PushConfig(host: "push.example.net", secret: "s3cret"))

    let off = config.registration(account: "personal", deviceToken: Data([0x01]), choice: NotificationChoice(mode: .off))
    let offBody = try #require(off.httpBody)
    let offJSON = try #require(JSONSerialization.jsonObject(with: offBody) as? [String: Any])
    #expect(offJSON["alerts"] as? Bool == false)
    #expect((offJSON["notify"] as? [String: Any])?["mode"] as? String == "off")
    #expect(offJSON["token"] as? String == "01")

    let custom = config.registration(
        account: "personal", deviceToken: Data([0x01]),
        choice: NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["P2F", "P3V"])
    )
    let customBody = try #require(custom.httpBody)
    let customJSON = try #require(JSONSerialization.jsonObject(with: customBody) as? [String: Any])
    #expect(customJSON["alerts"] as? Bool == true)
    let notify = try #require(customJSON["notify"] as? [String: Any])
    #expect(notify["mode"] as? String == "custom")
    #expect(notify["senders"] as? String == "vips")
    #expect(notify["mailboxIds"] as? [String] == ["P2F", "P3V"])
}

@Test func theTokenIsLowercaseHex() {
    #expect(PushConfig.hex(Data([0x00, 0xAB, 0xFF])) == "00abff")
    #expect(PushConfig.hex(Data()) == "")
}

@Test func theContactsFlagIsReadFromTheRegistrationReply() {
    func read(_ text: String) -> Bool? { PushConfig.contacts(fromRegistrationReply: Data(text.utf8)) }
    #expect(read(#"{"ok":true,"notify":{"mode":"inbox","senders":"everyone","mailboxIds":[]},"contacts":true}"#) == true)
    #expect(read(#"{"ok":true,"contacts":false}"#) == false)
    #expect(read(#"{"ok":true,"alerts":true}"#) == nil, "a server from before the flag")
    #expect(read(#"{"ok":true,"contacts":1}"#) == nil, "a number is not a flag")
    #expect(read("not json") == nil)
}

// The Archive button asks the push server to do the work: the phone holds no
// Fastmail credentials, and a background action has seconds rather than the
// time a whole sign-in would take.
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
    #expect(PushAction.category == "message")
}

// Three buttons, in the order they are drawn; iOS shows them in the order they
// are registered, so the order is the whole of the priority.
@Test func theNotificationCarriesTheThreeVerbsInOrder() {
    #expect(PushAction.allCases.map(\.rawValue) == ["archive", "later", "pin"])
    #expect(PushAction.allCases.map(\.title) == ["Archive", "Later", "Pin"])
}

// A press arrives as an identifier, and only these three are ours: a tap on
// the notification itself, or a dismissal, has to fall through to the link.
@Test func onlyTheThreeButtonsAreReadAsButtons() {
    #expect(PushAction(rawValue: "later") == .later)
    #expect(PushAction(rawValue: "com.apple.UNNotificationDefaultActionIdentifier") == nil)
    #expect(PushAction(rawValue: "") == nil)
}

// A press that does not land is said out loud, in the words of the verb that
// failed: the banner is gone by then, and silence would read as success.
@Test func eachVerbSaysItsOwnFailure() {
    #expect(PushAction.archive.failureTitle == "Not archived")
    #expect(PushAction.later.failureTitle == "Not filed")
    #expect(PushAction.pin.failureTitle == "Not pinned")
    #expect(PushAction.archive.failureBody == "The message is still in your Inbox.")
}
