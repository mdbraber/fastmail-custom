import Foundation
import Testing
@testable import FastmailShellKit

// The chooser app's whole job: take a mailto link and hand it to one of the
// two shells. Which one is the question it asks; this is the answer it sends.

@Test func theChooserOffersBothAccountsInOrder() {
    #expect(MailtoChooser.targets.map(\.id) == ["personal", "work"])
    #expect(MailtoChooser.targets.map(\.title) == ["Personal", "Work"])
    // The name each app wears on the home screen, so the button says which
    // one it means rather than leaving you to remember
    #expect(MailtoChooser.targets.map(\.subtitle) == ["mdbraber.com", "nexthealth.nl"])
}

// The schemes are the shells' own, not a second spelling of them: a rename on
// one side that did not reach the other would send mail into nowhere.
@Test func theChooserNamesTheSchemesTheShellsAnswerTo() {
    #expect(MailtoChooser.targets.map(\.scheme)
        == [Profile.personal(accountID: nil).urlScheme, Profile.work(accountID: nil).urlScheme])
}

// The command travels through iOS as a URL, and the receiving shell reads it
// with the router it already has. Asserting the round trip rather than the
// spelling: what matters is that the other app understands it.
@Test func aChosenAccountReceivesTheMailtoAsACompose() throws {
    let mailto = URL(string: "mailto:a@b.com?subject=Hi%20there&body=Hello")!
    let work = try #require(MailtoChooser.targets.first { $0.id == "work" })
    let command = try #require(MailtoChooser.compose(mailto, in: work))

    #expect(command.scheme == "fastmail-work")
    guard case .load(let page) = LinkRouter.route(command, profile: .work(accountID: nil)) else {
        Issue.record("the work shell did not read the command as a compose")
        return
    }
    #expect(page.absoluteString.contains("/mail/compose?mailto="))
    let fields = URLComponents(url: page, resolvingAgainstBaseURL: false)?.queryItems ?? []
    #expect(fields.first { $0.name == "mailto" }?.value == mailto.absoluteString)
}

// Anything that is not a mailto is not this app's business. The chooser is
// reachable by its own scheme too, and an address arriving that way is not to
// be forwarded into a compose window on trust.
@Test func onlyAMailtoIsForwarded() {
    let personal = MailtoChooser.targets[0]
    #expect(MailtoChooser.compose(URL(string: "https://example.com/")!, in: personal) == nil)
    #expect(MailtoChooser.compose(URL(string: "fastmail-mailto://open")!, in: personal) == nil)
    #expect(MailtoChooser.compose(URL(string: "MAILTO:a@b.com")!, in: personal) != nil)
}

// The chooser shows what it is about to forward, so a stray tap on a link you
// did not mean is caught before it opens a compose window in the wrong account.
@Test func theSummaryReadsTheRecipientAndSubject() throws {
    let summary = try #require(MailtoChooser.summary(of: URL(string: "mailto:a@b.com?subject=Hi%20there&body=x")!))
    #expect(summary.recipients == "a@b.com")
    #expect(summary.subject == "Hi there")
}

// A mailto can carry its recipients in a `to` field instead of after the
// colon, and several of them at once.
@Test func theSummaryReadsRecipientsWhereverTheyAre() throws {
    let listed = try #require(MailtoChooser.summary(of: URL(string: "mailto:a@b.com,c@d.com")!))
    #expect(listed.recipients == "a@b.com, c@d.com")
    #expect(listed.subject == nil)

    let queried = try #require(MailtoChooser.summary(of: URL(string: "mailto:?to=a%40b.com&subject=Hi")!))
    #expect(queried.recipients == "a@b.com")
}

// A mailto with nobody in it is still a message worth writing.
@Test func theSummaryOfAnEmptyMailtoSaysSoRatherThanNothing() throws {
    let summary = try #require(MailtoChooser.summary(of: URL(string: "mailto:")!))
    #expect(summary.recipients == "")
    #expect(MailtoChooser.summary(of: URL(string: "https://example.com")!) == nil)
}

// Until Apple grants the Default Mail App capability, iOS will not hand this
// app a mailto: tap at all. Its own scheme is the way in meanwhile — from a
// Shortcut, or from anything else that can open a URL — so it takes a mailto
// wrapped in the same compose command the shells answer to.
@Test func theChooserTakesAMailtoThroughItsOwnScheme() throws {
    let wrapped = URL(string: "fastmail-mailto://compose?mailto="
        + LinkRouter.percentEncode("mailto:a@b.com?subject=Hi there"))!
    #expect(MailtoChooser.incoming(wrapped)?.absoluteString == "mailto:a@b.com?subject=Hi%20there")
}

@Test func aDirectMailtoNeedsNoUnwrapping() {
    let direct = URL(string: "mailto:a@b.com")!
    #expect(MailtoChooser.incoming(direct) == direct)
}

// Anything else arriving on the scheme is not a message to write.
@Test func nothingButAMailtoGetsIn() {
    #expect(MailtoChooser.incoming(URL(string: "fastmail-mailto://compose?mailto=https%3A%2F%2Fevil.com")!) == nil)
    #expect(MailtoChooser.incoming(URL(string: "fastmail-mailto://open")!) == nil)
    #expect(MailtoChooser.incoming(URL(string: "https://example.com")!) == nil)
}
