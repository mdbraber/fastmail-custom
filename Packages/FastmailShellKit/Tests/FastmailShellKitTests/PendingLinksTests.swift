import Combine
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

// AppShell takes on every appearance, and a take that clears nothing would
// still publish, which is a change of view state for no reason
@Test @MainActor func takingNothingPublishesNothing() {
    let links = PendingLinks()
    let changes = ChangeCount()
    let token = links.objectWillChange.sink { _ in MainActor.assumeIsolated { changes.bump() } }
    defer { token.cancel() }

    _ = links.take()
    #expect(changes.count == 0)

    links.open(URL(string: "https://app.fastmail.com/mail/Inbox/T1")!)
    _ = links.take()
    #expect(changes.count == 2)
}

@MainActor private final class ChangeCount {
    private(set) var count = 0
    func bump() { count += 1 }
}
