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

// The prompt is worth showing only when there is a number to show.
@Test func authorizationIsRequestedOnlyWhenUndecidedAndThereIsACount() {
    #expect(BadgeController.move(authorization: .notDetermined, count: 5) == .request)
    #expect(BadgeController.move(authorization: .notDetermined, count: 0) == .skip)
}

// Read live, so a grant in Settings is honoured at once.
@Test func allowedProceedsWhateverTheCount() {
    #expect(BadgeController.move(authorization: .allowed, count: 9) == .proceed)
    #expect(BadgeController.move(authorization: .allowed, count: 0) == .proceed)
}

// Denied is denied — nothing to do until the user changes it, which the live
// read will see on the next badge.
@Test func deniedSkips() {
    #expect(BadgeController.move(authorization: .denied, count: 9) == .skip)
    #expect(BadgeController.move(authorization: .denied, count: 0) == .skip)
}
