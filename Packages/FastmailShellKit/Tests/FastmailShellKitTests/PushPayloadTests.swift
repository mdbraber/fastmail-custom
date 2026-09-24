import Foundation
import Testing
@testable import FastmailShellKit

@Test func theThreadAddressComesOutOfThePayload() {
    let url = PushPayload.url(from: ["url": "https://app.fastmail.com/mail/Inbox/T1", "emailId": "M1"])
    #expect(url?.absoluteString == "https://app.fastmail.com/mail/Inbox/T1")
}

@Test func aMissingOrOddAddressIsNothing() {
    #expect(PushPayload.url(from: [:]) == nil)
    #expect(PushPayload.url(from: ["url": 42]) == nil)
    #expect(PushPayload.url(from: ["url": ""]) == nil)
    #expect(PushPayload.url(from: ["url": "javascript:alert(1)"]) == nil)
    #expect(PushPayload.url(from: ["url": "http://app.fastmail.com/mail/Inbox/T1"]) == nil)
}

// The Archive button acts on one message, and the only thing that names it
// is the id the server puts beside the address.
@Test func theMessageIdComesOutOfThePayload() {
    #expect(PushPayload.emailId(from: ["url": "https://app.fastmail.com/mail/Inbox/T1.M1", "emailId": "M1"]) == "M1")
    #expect(PushPayload.emailId(from: [:]) == nil)
    #expect(PushPayload.emailId(from: ["emailId": ""]) == nil)
    #expect(PushPayload.emailId(from: ["emailId": 42]) == nil)
}

// A tapped notification opens through Fastmail's own goMessage, which
// refreshes a thread an idle window left stale. That entry point reads an
// EmailPush, so the payload's parts are packed back into one here.
@Test func theMessageDataIsBuiltForOpeningInPlace() throws {
    let json = PushPayload.messageData(from: [
        "emailId": "M1",
        "threadId": "T1",
        "mailboxIds": ["mbx-inbox": true],
        "accountId": "u123",
    ])
    let object = try JSONSerialization.jsonObject(
        with: #require(json).data(using: .utf8)!
    ) as! [String: Any]
    #expect(object["@type"] as? String == "EmailPush")
    #expect(object["accountId"] as? String == "u123")
    let email = object["email"] as! [String: Any]
    #expect(email["id"] as? String == "M1")
    #expect(email["threadId"] as? String == "T1")
    #expect((email["mailboxIds"] as? [String: Any])?["mbx-inbox"] as? Bool == true)
}

// Without the message, its mailboxes or the account there is nothing
// goMessage can act on, so this is nothing and the app opens the address.
@Test func theMessageDataIsNothingWithoutWhatGoMessageNeeds() {
    #expect(PushPayload.messageData(from: ["emailId": "M1", "mailboxIds": ["mbx-inbox": true], "accountId": "u123"]) != nil)
    #expect(PushPayload.messageData(from: [:]) == nil)
    #expect(PushPayload.messageData(from: ["mailboxIds": ["mbx-inbox": true], "accountId": "u123"]) == nil)
    #expect(PushPayload.messageData(from: ["emailId": "M1", "accountId": "u123"]) == nil)
    #expect(PushPayload.messageData(from: ["emailId": "M1", "mailboxIds": [String: Any](), "accountId": "u123"]) == nil)
    #expect(PushPayload.messageData(from: ["emailId": "M1", "mailboxIds": ["mbx-inbox": true]]) == nil)
}

// A silent push names the messages whose banners should come off; anything
// else in the list, or any other push, names none.
@Test func theDismissedIdsComeOutOfASilentPush() {
    #expect(PushPayload.dismissedIds(from: ["aps": ["content-available": 1], "dismiss": ["M1", "M2", "M1"]]) == ["M1", "M2"])
    #expect(PushPayload.dismissedIds(from: ["dismiss": ["M1", 42, ""]]) == ["M1"])
    #expect(PushPayload.dismissedIds(from: ["dismiss": "M1"]).isEmpty)
    #expect(PushPayload.dismissedIds(from: ["url": "https://app.fastmail.com/mail/Inbox/T1", "emailId": "M1"]).isEmpty)
}

// The markdown a shortcut returns is built here rather than in the page, so
// it carries the same canonical address as the URL beside it.
@Test func markdownPairsTheTitleWithTheAddress() {
    let url = URL(string: "https://app.fastmail.com/mail/Inbox/T1.M1")!
    #expect(CurrentLink.markdown(title: "Hello", url: url) == "[Hello](https://app.fastmail.com/mail/Inbox/T1.M1)")
}

// A subject with brackets in it is a subject, not markup.
@Test func markdownEscapesWhatWouldReadAsMarkup() {
    let url = URL(string: "https://app.fastmail.com/mail/Inbox")!
    #expect(CurrentLink.markdown(title: "[draft] c:\\path", url: url)
        == "[\\[draft\\] c:\\\\path](https://app.fastmail.com/mail/Inbox)")
}
