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

// The markdown a shortcut returns is built here rather than in the page, so
// it carries the same canonical address as the URL beside it.
@Test func markdownPairsTheTitleWithTheAddress() {
    let url = URL(string: "https://app.fastmail.com/mail/Inbox/T1.M1")!
    #expect(MailLink.markdown(title: "Hello", url: url) == "[Hello](https://app.fastmail.com/mail/Inbox/T1.M1)")
}

// A subject with brackets in it is a subject, not markup.
@Test func markdownEscapesWhatWouldReadAsMarkup() {
    let url = URL(string: "https://app.fastmail.com/mail/Inbox")!
    #expect(MailLink.markdown(title: "[draft] c:\\path", url: url)
        == "[\\[draft\\] c:\\\\path](https://app.fastmail.com/mail/Inbox)")
}
