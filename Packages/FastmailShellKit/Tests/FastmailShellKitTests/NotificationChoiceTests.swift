import Foundation
import Testing
@testable import FastmailShellKit

@Test func aChoiceDefaultsToEveryoneAndNoLabels() {
    let choice = NotificationChoice(mode: .inbox)
    #expect(choice.senders == .everyone)
    #expect(choice.mailboxIds == [])
    #expect(choice.excludedMailboxIds == [])
}

// The server refuses an empty id and a list over 200, so the app never keeps one
@Test func labelsAreKeptInOrderWithoutBlanksOrRepeats() {
    let choice = NotificationChoice(
        mode: .custom, mailboxIds: ["P2F", "", "P3V", "P2F"], excludedMailboxIds: ["P9L", "", "P8K", "P9L"]
    )
    #expect(choice.mailboxIds == ["P2F", "P3V"])
    #expect(choice.excludedMailboxIds == ["P9L", "P8K"])
}

@Test func noMoreThanTwoHundredLabelsAreKept() {
    let ids = (0..<250).map { "M\($0)" }
    let choice = NotificationChoice(mode: .custom, mailboxIds: ids, excludedMailboxIds: ids)
    #expect(choice.mailboxIds.count == 200)
    #expect(choice.excludedMailboxIds.count == 200)
}

@Test func thePagesPayloadParses() throws {
    let parsed = try NotificationChoice.parse([
        "mode": "custom", "senders": "vips", "mailboxIds": ["P2F", "P3V"], "excludedMailboxIds": ["P9L"],
    ]).get()
    #expect(parsed == NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["P2F", "P3V"], excludedMailboxIds: ["P9L"]))
}

@Test func aPayloadWithOnlyAModeTakesTheDefaults() throws {
    #expect(try NotificationChoice.parse(["mode": "off"]).get() == NotificationChoice(mode: .off))
    let nulls: [String: Any] = [
        "mode": "important", "senders": NSNull(), "mailboxIds": NSNull(), "excludedMailboxIds": NSNull(),
    ]
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
    #expect(message(["mode": "custom", "excludedMailboxIds": "P9L"])?.hasPrefix("excludedMailboxIds") == true)
    #expect(message(["mode": "custom", "excludedMailboxIds": ["P9L", ""]])?.hasPrefix("excludedMailboxIds") == true)
    #expect(message(["mode": "custom", "excludedMailboxIds": [NSNumber(value: 3)] as [Any]])?.hasPrefix("excludedMailboxIds") == true)
    #expect(message(["mode": "custom", "excludedMailboxIds": (0..<201).map { "M\($0)" }])?.hasPrefix("excludedMailboxIds") == true)
}

@Test func theJSONObjectCarriesAllFourFields() {
    let object = NotificationChoice(
        mode: .custom, senders: .contacts, mailboxIds: ["P2F"], excludedMailboxIds: ["P9L"]
    ).jsonObject
    #expect(object["mode"] as? String == "custom")
    #expect(object["senders"] as? String == "contacts")
    #expect(object["mailboxIds"] as? [String] == ["P2F"])
    #expect(object["excludedMailboxIds"] as? [String] == ["P9L"])
    #expect(object.count == 4)
}

@Test func theJSONTextIsSortedAndComplete() {
    let text = NotificationChoice(mode: .inbox).json
    #expect(text == #"{"excludedMailboxIds":[],"mailboxIds":[],"mode":"inbox","senders":"everyone"}"#)
}

@Test func aChoiceSurvivesCodable() throws {
    let choice = NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["A", "B"], excludedMailboxIds: ["C"])
    let data = try JSONEncoder().encode(choice)
    #expect(try JSONDecoder().decode(NotificationChoice.self, from: data) == choice)
}
