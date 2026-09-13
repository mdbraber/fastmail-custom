import Foundation
import Testing
@testable import FastmailShellKit

/// A fixed instant on the continuous clock, which the Settings app cannot set.
private let start = ContinuousClock.now

/// A lock that asked at launch and was opened.
private func unlocked() -> ScreenLockState {
    var state = ScreenLockState(lockEnabled: true)
    _ = state.becameActive(at: start, lockEnabled: true)
    state.finishedAsking(succeeded: true)
    return state
}

@Test func theLockAsksAtLaunch() {
    var state = ScreenLockState(lockEnabled: true)
    #expect(state.isLocked)
    let asked = state.becameActive(at: start, lockEnabled: true)
    #expect(asked)
    #expect(state.isAsking)
    // SwiftUI can say the app is active twice; one ask is enough
    let askedAgain = state.becameActive(at: start, lockEnabled: true)
    #expect(!askedAgain)
}

@Test func withoutTheLockNothingIsAskedOrCovered() {
    var state = ScreenLockState(lockEnabled: false)
    #expect(!state.isLocked)
    let asked = state.becameActive(at: start, lockEnabled: false)
    #expect(!asked)
    state.enteredBackground(at: start)
    let askedLater = state.becameActive(at: start.advanced(by: .seconds(3600)), lockEnabled: false)
    #expect(!askedLater)
    #expect(!state.coversContent(isInFront: false, lockEnabled: false))
    #expect(!state.wouldBeLocked(at: start.advanced(by: .seconds(3600)), lockEnabled: false))
}

@Test func theLockAsksAfterMoreThanAMinuteAway() {
    var state = unlocked()
    state.enteredBackground(at: start)
    let asked = state.becameActive(at: start.advanced(by: .milliseconds(60_500)), lockEnabled: true)
    #expect(asked)
    #expect(state.isLocked)
}

@Test func theLockDoesNotAskAfterAMinuteOrLess() {
    for away: Duration in [.zero, .seconds(30), .seconds(60)] {
        var state = unlocked()
        state.enteredBackground(at: start)
        let asked = state.becameActive(at: start.advanced(by: away), lockEnabled: true)
        #expect(!asked, "away \(away)")
        #expect(!state.isLocked, "away \(away)")
        #expect(!state.coversContent(isInFront: true, lockEnabled: true), "away \(away)")
    }
}

@Test func aFailedOrCancelledAskKeepsTheCoverAndWaitsForUnlock() {
    var state = ScreenLockState(lockEnabled: true)
    _ = state.becameActive(at: start, lockEnabled: true)
    state.finishedAsking(succeeded: false)
    #expect(state.isLocked)
    #expect(state.coversContent(isInFront: true, lockEnabled: true))
    // The prompt itself takes the app out of the front and back again, which
    // is not a return from the background
    let askedByItself = state.becameActive(at: start.advanced(by: .seconds(1)), lockEnabled: true)
    #expect(!askedByItself)
    let askedByUnlock = state.unlockTapped()
    #expect(askedByUnlock)
    let askedTwice = state.unlockTapped()
    #expect(!askedTwice)
    state.finishedAsking(succeeded: true)
    #expect(!state.isLocked)
    #expect(!state.coversContent(isInFront: true, lockEnabled: true))
}

@Test func unlockAsksNothingOfAnAppThatIsNotLocked() {
    var state = unlocked()
    let asked = state.unlockTapped()
    #expect(!asked)
}

@Test func aLockThatWasNeverOpenedAsksAgainOnReturnHoweverSoon() {
    var state = ScreenLockState(lockEnabled: true)
    _ = state.becameActive(at: start, lockEnabled: true)
    state.finishedAsking(succeeded: false)
    state.enteredBackground(at: start.advanced(by: .seconds(5)))
    let asked = state.becameActive(at: start.advanced(by: .seconds(10)), lockEnabled: true)
    #expect(asked)
}

@Test func theCoverIsUpWheneverTheAppIsNotInFront() {
    let state = unlocked()
    #expect(state.coversContent(isInFront: false, lockEnabled: true))
    #expect(!state.coversContent(isInFront: true, lockEnabled: true))
}

@Test func aLockThatCannotAskLetsTheAppOpen() {
    var state = ScreenLockState(lockEnabled: true)
    _ = state.becameActive(at: start, lockEnabled: true)
    state.cannotAsk()
    #expect(!state.isLocked)
    #expect(!state.isAsking)
}

@Test func linksWaitWhileTheLockIsUpOrAboutToBe() {
    #expect(ScreenLockState(lockEnabled: true).wouldBeLocked(at: start, lockEnabled: true))
    var state = unlocked()
    #expect(!state.wouldBeLocked(at: start, lockEnabled: true))
    state.enteredBackground(at: start)
    #expect(!state.wouldBeLocked(at: start.advanced(by: .seconds(60)), lockEnabled: true))
    #expect(state.wouldBeLocked(at: start.advanced(by: .seconds(61)), lockEnabled: true))
}

@Test func turningTheLockOnWhileTheAppIsOpenDoesNotLockIt() {
    var state = ScreenLockState(lockEnabled: false)
    let asked = state.becameActive(at: start, lockEnabled: true)
    #expect(!asked)
    #expect(!state.isLocked)
}

@Test func theSwitchIsNamedForWhatTheDeviceUnlocksWith() {
    #expect(ScreenLockMethod.faceID.title == "Face ID")
    #expect(ScreenLockMethod.touchID.title == "Touch ID")
    #expect(ScreenLockMethod.passcode.title == "Passcode")
    #expect(ScreenLockMethod.unavailable.title == "Passcode")
    #expect(ScreenLockMethod.faceID.footer == "Require authentication when opening the app")
}

@Test func withoutAPasscodeTheLockCannotBeTurnedOn() {
    #expect(!ScreenLockMethod.unavailable.canLock)
    #expect(ScreenLockMethod.unavailable.footer == "Set a passcode for this device in the Settings app first.")
    for method: ScreenLockMethod in [.faceID, .touchID, .opticID, .passcode] {
        #expect(method.canLock)
    }
}

// Sent to the background while Face ID is asking, the prompt is cancelled and
// its reply arrives as a failure; coming back asks again, however soon
@Test func anAskInterruptedByTheBackgroundAsksAgainOnReturn() {
    for away: Duration in [.seconds(5), .seconds(120)] {
        var state = ScreenLockState(lockEnabled: true)
        _ = state.becameActive(at: start, lockEnabled: true)
        #expect(state.isAsking)
        state.enteredBackground(at: start.advanced(by: .seconds(1)))
        state.finishedAsking(succeeded: false)
        #expect(!state.isAsking, "away \(away)")
        #expect(state.isLocked, "away \(away)")
        let asked = state.becameActive(at: start.advanced(by: .seconds(1) + away), lockEnabled: true)
        #expect(asked, "away \(away)")
        let unlock = state.unlockTapped()
        #expect(!unlock, "already asking, away \(away)")
    }
}
