import Foundation
import Testing
@testable import FastmailShellKit

@Test @MainActor func aLinkIsTakenOnce() {
    let links = PendingLinks()
    #expect(links.take() == nil)
    links.open(URL(string: "https://app.fastmail.com/mail/Inbox/T1")!)
    #expect(links.take()?.absoluteString == "https://app.fastmail.com/mail/Inbox/T1")
    #expect(links.take() == nil)
}
