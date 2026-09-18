import Foundation
import Testing
import UserNotifications
@testable import FastmailShellKit

// Provisional delivery still reaches the device, so only a refusal and a
// question not yet asked read as something else
@Test func thePermissionReadsAsThePageNamesIt() {
    #expect(NotificationState.Permission(status: .authorized) == .allowed)
    #expect(NotificationState.Permission(status: .provisional) == .allowed)
    #expect(NotificationState.Permission(status: .denied) == .denied)
    #expect(NotificationState.Permission(status: .notDetermined) == .undetermined)
}

@Test func theStateAnswersWithEveryField() throws {
    let state = NotificationState(
        choice: NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["P2F"], excludedMailboxIds: ["P9L"]),
        permission: .denied,
        pushToken: "00abff",
        contacts: false
    )
    let object = try #require(JSONSerialization.jsonObject(with: Data(state.json.utf8)) as? [String: Any])
    #expect(object["mode"] as? String == "custom")
    #expect(object["senders"] as? String == "vips")
    #expect(object["mailboxIds"] as? [String] == ["P2F"])
    #expect(object["excludedMailboxIds"] as? [String] == ["P9L"])
    #expect(object["permission"] as? String == "denied")
    #expect(object["pushToken"] as? String == "00abff")
    #expect(object["contacts"] as? Bool == false)
    #expect(object["previews"] as? Bool == true)
    #expect(object.count == 8)
}

// Unknown is null, never false: false would raise the contacts warning
@Test func anUnknownTokenAndContactsFlagAnswerAsNull() throws {
    let state = NotificationState(
        choice: NotificationChoice(mode: .inbox), permission: .allowed, pushToken: nil, contacts: nil
    )
    let object = try #require(JSONSerialization.jsonObject(with: Data(state.json.utf8)) as? [String: Any])
    #expect(object["pushToken"] is NSNull)
    #expect(object["contacts"] is NSNull)
}
