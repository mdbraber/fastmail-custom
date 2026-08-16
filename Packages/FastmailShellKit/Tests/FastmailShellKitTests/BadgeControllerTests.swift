import Foundation
import Testing
@testable import FastmailShellKit

@Test func zeroClearsRatherThanShowsZero() {
    #expect(BadgeController.action(for: 0) == .clear)
}

@Test func aMissingCountLeavesTheBadgeUnchanged() {
    #expect(BadgeController.action(for: nil) == .leave)
    #expect(BadgeController.action(for: -3) == .leave)
}

@Test func aPositiveCountShows() {
    #expect(BadgeController.action(for: 7) == .show(7))
}

@Test func authorizationIsRequestedOnTheFirstNonZeroCountOnly() {
    #expect(BadgeController.authorizationMove(requested: false, denied: false, count: 5) == .request)
    #expect(BadgeController.authorizationMove(requested: true, denied: false, count: 5) == .proceed)
    #expect(BadgeController.authorizationMove(requested: false, denied: false, count: 0) == .proceed)
}

@Test func declinedAuthorizationIsNeverReRequested() {
    #expect(BadgeController.authorizationMove(requested: true, denied: true, count: 9) == .skip)
    #expect(BadgeController.authorizationMove(requested: true, denied: true, count: 0) == .skip)
}
