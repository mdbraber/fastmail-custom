import Foundation
import Testing
@testable import FastmailShellKit

private func destination(_ string: String, inAppBrowser: Bool) -> ExternalLinkDestination {
    ExternalLinks.destination(for: URL(string: string)!, inAppBrowser: inAppBrowser)
}

@Test func withTheSwitchOnWebLinksOpenInTheInAppBrowser() {
    #expect(destination("https://example.com/article", inAppBrowser: true) == .inAppBrowser)
    #expect(destination("http://example.com/", inAppBrowser: true) == .inAppBrowser)
    #expect(destination("HTTPS://Example.com/", inAppBrowser: true) == .inAppBrowser)
}

@Test func withTheSwitchOnEveryOtherSchemeStillGoesToTheSystem() {
    let links = [
        "mailto:someone@example.com",
        "tel:+3112345678",
        "facetime:someone@example.com",
        "webcal://example.com/calendar.ics",
        "fastmail-work://open?url=https%3A%2F%2Fapp.fastmail.com%2F&handoff=1",
        // A web scheme with no host is nothing the in-app browser can show
        "https:no-host"
    ]
    for link in links {
        #expect(destination(link, inAppBrowser: true) == .system, "\(link)")
    }
}

@Test func withTheSwitchOffEveryLinkGoesToTheSystem() {
    let links = [
        "https://example.com/article",
        "http://example.com/",
        "mailto:someone@example.com",
        "tel:+3112345678",
        "facetime:someone@example.com",
        "webcal://example.com/calendar.ics"
    ]
    for link in links {
        #expect(destination(link, inAppBrowser: false) == .system, "\(link)")
    }
}
