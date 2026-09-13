import Foundation

/// When the screen lock asks, and when its cover is up. Pure, so the timing can
/// be tested anywhere; ScreenLock carries it out on iPhone and iPad.
///
/// The app asks at launch, and when it comes back to the front after more than
/// a minute in the background. Face ID's own prompt takes the app out of the
/// front and back again without sending it to the background, so only time in
/// the background counts, and an ask that failed or was cancelled waits for
/// Unlock rather than asking again by itself.
public struct ScreenLockState: Equatable, Sendable {
    /// How long the app may be away before it asks again. Exactly this long
    /// does not ask.
    public static let gracePeriod: TimeInterval = 60

    public private(set) var isLocked: Bool
    public private(set) var isAsking = false
    private var backgroundSince: Date?
    private var askedSinceBackground = false

    /// A launch with the lock on starts locked.
    public init(lockEnabled: Bool) {
        isLocked = lockEnabled
    }

    public mutating func enteredBackground(at now: Date) {
        if backgroundSince == nil { backgroundSince = now }
        askedSinceBackground = false
    }

    /// The app is in front again, or for the first time. Answers whether to
    /// ask now.
    public mutating func becameActive(at now: Date, lockEnabled: Bool) -> Bool {
        guard lockEnabled else {
            isLocked = false
            backgroundSince = nil
            return false
        }
        if let since = backgroundSince {
            backgroundSince = nil
            if now.timeIntervalSince(since) > Self.gracePeriod { isLocked = true }
        }
        guard isLocked, !isAsking, !askedSinceBackground else { return false }
        isAsking = true
        askedSinceBackground = true
        return true
    }

    /// The cover's Unlock button. Answers whether to ask now.
    public mutating func unlockTapped() -> Bool {
        guard isLocked, !isAsking else { return false }
        isAsking = true
        return true
    }

    public mutating func finishedAsking(succeeded: Bool) {
        isAsking = false
        if succeeded { isLocked = false }
    }

    /// The device can no longer ask, because its passcode was removed after
    /// the lock was turned on. The app opens; the caller turns the switch off.
    public mutating func cannotAsk() {
        isAsking = false
        isLocked = false
    }

    /// Whether the app is locked, or will be the moment it is in front again.
    /// A link handed in now waits until the lock has opened.
    public func wouldBeLocked(at now: Date, lockEnabled: Bool) -> Bool {
        guard lockEnabled else { return false }
        if isLocked { return true }
        guard let since = backgroundSince else { return false }
        return now.timeIntervalSince(since) > Self.gracePeriod
    }

    /// The cover is up while the app is locked, and whenever it is not in
    /// front, so the app switcher's snapshot shows no mail.
    public func coversContent(isInFront: Bool, lockEnabled: Bool) -> Bool {
        lockEnabled && (isLocked || !isInFront)
    }
}

/// What the device unlocks with, which names the switch.
public enum ScreenLockMethod: Equatable, Sendable {
    case faceID
    case touchID
    case opticID
    case passcode
    /// No passcode is set, so there is nothing to ask for.
    case unavailable

    public var title: String {
        switch self {
        case .faceID: "Face ID"
        case .touchID: "Touch ID"
        case .opticID: "Optic ID"
        case .passcode, .unavailable: "Passcode"
        }
    }

    public var canLock: Bool {
        self != .unavailable
    }

    public var footer: String {
        canLock
            ? "Require authentication when opening the app"
            : "Set a passcode for this device in the Settings app first."
    }
}
