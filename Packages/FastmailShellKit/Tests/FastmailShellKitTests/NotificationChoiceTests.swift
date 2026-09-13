import Foundation
import Testing
@testable import FastmailShellKit

@Test func aChoiceDefaultsToEveryoneAndNoLabels() {
    let choice = NotificationChoice(mode: .inbox)
    #expect(choice.senders == .everyone)
    #expect(choice.mailboxIds == [])
}

// The server refuses an empty id and a list over 200, so the app never keeps one
@Test func labelsAreKeptInOrderWithoutBlanksOrRepeats() {
    let choice = NotificationChoice(mode: .custom, mailboxIds: ["P2F", "", "P3V", "P2F"])
    #expect(choice.mailboxIds == ["P2F", "P3V"])
}

@Test func noMoreThanTwoHundredLabelsAreKept() {
    let ids = (0..<250).map { "M\($0)" }
    #expect(NotificationChoice(mode: .custom, mailboxIds: ids).mailboxIds.count == 200)
}

@Test func thePagesPayloadParses() throws {
    let parsed = try NotificationChoice.parse([
        "mode": "custom", "senders": "vips", "mailboxIds": ["P2F", "P3V"],
    ]).get()
    #expect(parsed == NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["P2F", "P3V"]))
}

@Test func aPayloadWithOnlyAModeTakesTheDefaults() throws {
    #expect(try NotificationChoice.parse(["mode": "off"]).get() == NotificationChoice(mode: .off))
    let nulls: [String: Any] = ["mode": "important", "senders": NSNull(), "mailboxIds": NSNull()]
    #expect(try NotificationChoice.parse(nulls).get() == NotificationChoice(mode: .important))
}

// Each refusal names its field, the way the push server's 400 does
@Test func eachBadFieldIsRefusedByName() {
    func message(_ payload: [String: Any]) -> String? {
        if case .failure(let invalid) = NotificationChoice.parse(payload) { return invalid.message }
        return nil
    }
    #expect(message([:])?.hasPrefix("mode") == true)
    #expect(message(["mode": "loud"])?.hasPrefix("mode") == true)
    #expect(message(["mode": NSNumber(value: 1)])?.hasPrefix("mode") == true)
    #expect(message(["mode": "custom", "senders": "friends"])?.hasPrefix("senders") == true)
    #expect(message(["mode": "custom", "mailboxIds": "P2F"])?.hasPrefix("mailboxIds") == true)
    #expect(message(["mode": "custom", "mailboxIds": ["P2F", ""]])?.hasPrefix("mailboxIds") == true)
    #expect(message(["mode": "custom", "mailboxIds": ["P2F", NSNumber(value: 3)] as [Any]])?.hasPrefix("mailboxIds") == true)
    #expect(message(["mode": "custom", "mailboxIds": (0..<201).map { "M\($0)" }])?.hasPrefix("mailboxIds") == true)
}

@Test func theJSONObjectCarriesAllThreeFields() {
    let object = NotificationChoice(mode: .custom, senders: .contacts, mailboxIds: ["P2F"]).jsonObject
    #expect(object["mode"] as? String == "custom")
    #expect(object["senders"] as? String == "contacts")
    #expect(object["mailboxIds"] as? [String] == ["P2F"])
    #expect(object.count == 3)
}

@Test func theJSONTextIsSortedAndComplete() {
    let text = NotificationChoice(mode: .inbox).json
    #expect(text == #"{"mailboxIds":[],"mode":"inbox","senders":"everyone"}"#)
}

@Test func aChoiceSurvivesCodable() throws {
    let choice = NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["A", "B"])
    let data = try JSONEncoder().encode(choice)
    #expect(try JSONDecoder().decode(NotificationChoice.self, from: data) == choice)
}
