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
