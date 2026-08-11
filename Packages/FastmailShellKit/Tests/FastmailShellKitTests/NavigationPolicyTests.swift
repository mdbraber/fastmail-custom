import Testing
import Foundation
@testable import FastmailShellKit

private func decide(_ string: String) -> NavigationDecision {
    NavigationPolicy.decide(url: URL(string: string)!)
}

@Test func allowsFastmailAndItsSubdomains() {
    #expect(decide("https://app.fastmail.com/mail/Inbox") == .allow)
    #expect(decide("https://fastmail.com/") == .allow)
    #expect(decide("https://www.fastmail.com/help") == .allow)
}

@Test func allowsAttachmentHost() {
    #expect(decide("https://a1.fastmailusercontent.com/file.pdf") == .allow)
    #expect(decide("https://fastmailusercontent.com/file.pdf") == .allow)
}

@Test func refusesLookalikeHosts() {
    #expect(decide("https://notfastmail.com/") == .openExternally)
    #expect(decide("https://fastmail.com.evil.example/") == .openExternally)
    #expect(decide("https://evilfastmailusercontent.com/") == .openExternally)
}

@Test func sendsOrdinaryLinksToTheBrowser() {
    #expect(decide("https://example.com/article") == .openExternally)
}

@Test func sendsNonWebSchemesOutward() {
    #expect(decide("mailto:someone@example.com") == .openExternally)
    #expect(decide("tel:+3112345678") == .openExternally)
}

@Test func downloadsWhenContentDispositionSaysAttachment() {
    #expect(NavigationPolicy.decideResponse(
        canShowMIMEType: true,
        contentDisposition: "attachment; filename=\"invoice.pdf\""
    ) == .download)
}

@Test func downloadsWhenWebKitCannotRenderTheType() {
    #expect(NavigationPolicy.decideResponse(canShowMIMEType: false, contentDisposition: nil) == .download)
}

@Test func leavesRenderableInlineContentToFastmail() {
    #expect(NavigationPolicy.decideResponse(canShowMIMEType: true, contentDisposition: "inline") == .allow)
    #expect(NavigationPolicy.decideResponse(canShowMIMEType: true, contentDisposition: nil) == .allow)
}
