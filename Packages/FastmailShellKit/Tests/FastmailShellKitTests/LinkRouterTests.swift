import Foundation
import Testing
@testable import FastmailShellKit

private func profile(
    accountID: String? = "f00dcafe",
    handoffScheme: String? = "fastmail-work"
) -> Profile {
    Profile(
        id: "personal",
        displayName: "Test",
        startURL: URL(string: "https://app.fastmail.com/")!,
        overlayScriptName: nil,
        urlScheme: "fastmail-personal",
        accountID: accountID,
        handoffScheme: handoffScheme,
        backend: .production
    )
}

private func url(_ text: String) -> URL {
    URL(string: text)!
}

private func fastmailComposeFields(of composeURL: URL) -> [String: String] {
    let components = URLComponents(url: composeURL, resolvingAgainstBaseURL: false)!
    guard let mailto = (components.queryItems ?? []).first(where: { $0.name == "mailto" })?.value else {
        return [:]
    }
    var rest = String(mailto.dropFirst(7))
    if let question = rest.firstIndex(of: "?") {
        rest.replaceSubrange(question...question, with: "&")
    }
    if rest.hasPrefix("&") {
        rest.removeFirst()
    } else {
        rest = "to=" + rest
    }
    let allowed: Set<String> = ["to", "cc", "bcc", "subject", "body", "in-reply-to"]
    var fields: [String: String] = [:]
    for pair in rest.split(separator: "&") {
        let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        let key = (String(parts[0]).removingPercentEncoding ?? "").lowercased()
        let value = parts.count > 1 ? (String(parts[1]).removingPercentEncoding ?? "") : ""
        if allowed.contains(key) {
            fields[key] = value
        }
    }
    return fields
}

@Test func openAcceptsOnlyTheFastmailAppHost() {
    let good = url("fastmail-personal://open?url=https%3A%2F%2Fapp.fastmail.com%2Fmail%2FInbox%2F")
    #expect(LinkRouter.route(good, profile: profile()) == .load(url("https://app.fastmail.com/mail/Inbox/")))

    let evil = url("fastmail-personal://open?url=https%3A%2F%2Fevil.com%2F")
    guard case .refuse = LinkRouter.route(evil, profile: profile()) else {
        Issue.record("evil host was not refused")
        return
    }

    let spoof = url("fastmail-personal://open?url=https%3A%2F%2Fapp.fastmail.com.evil.com%2F")
    guard case .refuse = LinkRouter.route(spoof, profile: profile()) else {
        Issue.record("suffix-spoofed host was not refused")
        return
    }

    let insecure = url("fastmail-personal://open?url=http%3A%2F%2Fapp.fastmail.com%2F")
    guard case .refuse = LinkRouter.route(insecure, profile: profile()) else {
        Issue.record("http was not refused")
        return
    }
}

@Test func openWithoutADestinationIsRefused() {
    guard case .refuse = LinkRouter.route(url("fastmail-personal://open"), profile: profile()) else {
        Issue.record("missing url parameter was not refused")
        return
    }
}

@Test func unknownCommandsAndSchemesAreRefused() {
    guard case .refuse = LinkRouter.route(url("fastmail-personal://frobnicate"), profile: profile()) else {
        Issue.record("unknown command was not refused")
        return
    }
    guard case .refuse = LinkRouter.route(url("ftp://example.com/"), profile: profile()) else {
        Issue.record("unknown scheme was not refused")
        return
    }
}

@Test func aMatchingOrAbsentAccountLoadsLocally() {
    let matching = url("https://app.fastmail.com/mail/Inbox/?u=f00dcafe")
    #expect(LinkRouter.route(matching, profile: profile()) == .load(matching))

    let absent = url("https://app.fastmail.com/mail/Inbox/")
    #expect(LinkRouter.route(absent, profile: profile()) == .load(absent))
}

@Test func aMismatchedAccountHandsOffWithTheGuardFlag() throws {
    let foreign = url("https://app.fastmail.com/mail/Inbox/?u=0badc0de&filter=actionable")
    guard case .handoff(let handoff) = LinkRouter.route(foreign, profile: profile()) else {
        Issue.record("mismatched account did not hand off")
        return
    }
    let components = try #require(URLComponents(url: handoff, resolvingAgainstBaseURL: false))
    #expect(components.scheme == "fastmail-work")
    #expect(components.host == "open")
    let items = components.queryItems ?? []
    #expect(items.first(where: { $0.name == "url" })?.value == foreign.absoluteString)
    #expect(items.first(where: { $0.name == "handoff" })?.value == "1")
}

@Test func theHandoffFlagForcesALocalLoad() {
    let bounced = url(
        "fastmail-personal://open?url=https%3A%2F%2Fapp.fastmail.com%2Fmail%2FInbox%2F%3Fu%3D0badc0de&handoff=1"
    )
    #expect(
        LinkRouter.route(bounced, profile: profile())
            == .load(url("https://app.fastmail.com/mail/Inbox/?u=0badc0de"))
    )

    let direct = url("https://app.fastmail.com/mail/Inbox/?u=0badc0de&handoff=1")
    #expect(
        LinkRouter.route(direct, profile: profile())
            == .load(url("https://app.fastmail.com/mail/Inbox/?u=0badc0de"))
    )
}

@Test func aMissingAccountIDNeverHandsOff() {
    let foreign = url("https://app.fastmail.com/mail/Inbox/?u=0badc0de")
    #expect(LinkRouter.route(foreign, profile: profile(accountID: nil)) == .load(foreign))
}

@Test func aMissingHandoffSchemeLoadsLocallyOnMismatch() {
    let foreign = url("https://app.fastmail.com/mail/Inbox/?u=0badc0de")
    #expect(LinkRouter.route(foreign, profile: profile(handoffScheme: nil)) == .load(foreign))
}

@Test func aRawMailtoTranslatesThroughThePinnedTemplate() {
    let mailto = url("mailto:a%40b.com?subject=Hi%20there")
    guard case .load(let compose) = LinkRouter.route(mailto, profile: profile()) else {
        Issue.record("mailto did not load")
        return
    }
    #expect(compose.absoluteString.hasPrefix("https://app.fastmail.com/mail/compose?mailto="))
    let items = URLComponents(url: compose, resolvingAgainstBaseURL: false)?.queryItems ?? []
    #expect(items.first(where: { $0.name == "u" })?.value == "f00dcafe")
    let fields = fastmailComposeFields(of: compose)
    #expect(fields["to"] == "a@b.com")
    #expect(fields["subject"] == "Hi there")
}

@Test func theComposeCommandTranslatesItsMailtoParameter() {
    let inner = "mailto:a@b.com?subject=Hi%20there"
    let command = url("fastmail-personal://compose?mailto=" + LinkRouter.percentEncode(inner))
    guard case .load(let compose) = LinkRouter.route(command, profile: profile()) else {
        Issue.record("compose command did not load")
        return
    }
    let fields = fastmailComposeFields(of: compose)
    #expect(fields["to"] == "a@b.com")
    #expect(fields["subject"] == "Hi there")
}

@Test func aComposeCommandWithoutAMailtoIsRefused() {
    guard case .refuse = LinkRouter.route(url("fastmail-personal://compose"), profile: profile()) else {
        Issue.record("empty compose was not refused")
        return
    }
    let notAMailto = url("fastmail-personal://compose?mailto=https%3A%2F%2Fevil.com")
    guard case .refuse = LinkRouter.route(notAMailto, profile: profile()) else {
        Issue.record("non-mailto compose was not refused")
        return
    }
}

@Test func composeCarriesNoAccountWhenTheProfileHasNone() {
    let compose = LinkRouter.composeURL(mailto: "mailto:a@b.com", accountID: nil)
    let items = URLComponents(url: compose, resolvingAgainstBaseURL: false)?.queryItems ?? []
    #expect(!items.contains { $0.name == "u" })
}

@Test func everyMailtoFieldSurvivesBothDecodeLayers() {
    let mailto = "mailto:jan%2Btest@example.com"
        + "?subject=Hello%20%26%20goodbye%20%3D%20fun%3F%20100%25%20%C3%9Cn%C3%AF%E2%9C%93"
        + "&body=Line1%0ALine2"
        + "&cc=c%40d.com"
    let compose = LinkRouter.composeURL(mailto: mailto, accountID: "f00dcafe")
    let fields = fastmailComposeFields(of: compose)
    #expect(fields["to"] == "jan+test@example.com")
    #expect(fields["subject"] == "Hello & goodbye = fun? 100% Ünï✓")
    #expect(fields["body"] == "Line1\nLine2")
    #expect(fields["cc"] == "c@d.com")
}

@Test func theHandoffTargetRoundTripsThroughTheHandoffURL() throws {
    let original = url("https://app.fastmail.com/mail/Inbox/?u=0badc0de&filter=actionable")
    let handoff = try #require(LinkRouter.handoffURL(scheme: "fastmail-work", target: original))
    #expect(LinkRouter.handoffTarget(handoff) == original)
    #expect(LinkRouter.handoffTarget(url("fastmail-work://compose?mailto=x")) == nil)
}

@Test func anAddresslessMailtoStillReachesCompose() {
    let compose = LinkRouter.composeURL(mailto: "mailto:?to=a%40b.com&subject=Hi", accountID: nil)
    let fields = fastmailComposeFields(of: compose)
    #expect(fields["to"] == "a@b.com")
    #expect(fields["subject"] == "Hi")
}

@Test func aLinkToTheOtherServerIsStillAFastmailLink() {
    let beta = url("fastmail-personal://open?url=https%3A%2F%2Fapp.beta.fastmail.com%2Fmail%2FInbox%2F")
    #expect(LinkRouter.route(beta, profile: profile())
        == .load(url("https://app.beta.fastmail.com/mail/Inbox/")))
    #expect(LinkRouter.isFastmailHost("app.beta.fastmail.com"))
    #expect(LinkRouter.isFastmailHost("APP.BETA.FASTMAIL.COM."))
    #expect(!LinkRouter.isFastmailHost("beta.fastmail.com"))
    #expect(!LinkRouter.isFastmailHost("app.beta.fastmail.com.evil.example"))
}

// Incoming links take either server; addresses the app builds itself follow
// the profile, which is the setting
@Test func composeIsBuiltOnTheProfilesBackend() {
    let onBeta = profile().on(.beta)
    let compose = LinkRouter.composeURL(
        mailto: "mailto:a@b.com",
        accountID: nil,
        backend: onBeta.backend
    )
    #expect(compose.host == "app.beta.fastmail.com")
    #expect(ComposeURL.url(for: onBeta).absoluteString
        .hasPrefix("https://app.beta.fastmail.com/mail/Inbox/compose"))
    #expect(ComposeURL.url(for: profile()).absoluteString
        .hasPrefix("https://app.fastmail.com/mail/Inbox/compose"))
    #expect(ComposeURL.url(for: onBeta).query?.contains("ui=minimal") == true)
}

@Test func aMailtoLinkComposesOnTheProfilesBackend() {
    guard case .load(let target) = LinkRouter.route(url("mailto:a@b.com"), profile: profile().on(.beta)) else {
        Issue.record("a mailto link did not compose")
        return
    }
    #expect(target.host == "app.beta.fastmail.com")
}

@Test func aProfileMovedToAnotherBackendKeepsEverythingElse() {
    let base = profile()
    let moved = base.on(.beta)
    #expect(moved.backend == .beta)
    #expect(base.backend == .production)
    #expect(moved.id == base.id)
    #expect(moved.accountID == base.accountID)
    #expect(moved.handoffScheme == base.handoffScheme)
    #expect(moved.urlScheme == base.urlScheme)
}
