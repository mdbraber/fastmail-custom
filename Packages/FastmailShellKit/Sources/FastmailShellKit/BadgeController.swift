import Foundation

#if canImport(UIKit)
import UIKit
import UserNotifications
#else
import AppKit
#endif

public enum BadgeAction: Equatable, Sendable {
    case leave
    case clear
    case show(Int)
}

/// The app's own reading of the platform's badge permission, kept simple so
/// the decision is one testable function rather than scattered across the
/// UserNotifications callbacks.
public enum BadgeAuthorization: Equatable, Sendable {
    case notDetermined
    case denied
    case allowed
}

public enum BadgeAuthorizationMove: Equatable, Sendable {
    case proceed
    case skip
}

@MainActor
public final class BadgeController {
    public static let shared = BadgeController()

    // The last count we were asked to show, so the badge can be re-asserted
    // when the app returns to the front — that is when a permission just
    // granted in Settings first takes effect, and when a number that went
    // stale while the app slept is corrected.
    private var lastCount: Int?

    init() {}

    nonisolated public static func action(for count: Int?) -> BadgeAction {
        guard let count, count >= 0 else { return .leave }
        return count == 0 ? .clear : .show(count)
    }

    /// The decision, read from the live authorization status rather than a
    /// remembered flag: a permission the user grants — or revokes — in Settings
    /// is honoured on the very next badge, without an app restart. Asking is
    /// the push registrar's, at launch; an undecided status waits for that.
    nonisolated public static func move(
        authorization: BadgeAuthorization, count: Int
    ) -> BadgeAuthorizationMove {
        switch authorization {
        case .denied, .notDetermined:
            return .skip
        case .allowed:
            return .proceed
        }
    }

    public func apply(_ count: Int?) {
        switch Self.action(for: count) {
        case .leave:
            return
        case .clear:
            lastCount = 0
            set(0)
        case .show(let value):
            lastCount = value
            set(value)
        }
    }

    /// Re-assert the last badge we knew about. Called when the app becomes
    /// active, so a permission just changed in Settings, or a count that
    /// drifted while the app was away, lands without waiting for the next
    /// count. The push registrar calls this once its permission prompt is
    /// answered.
    public func reapply() {
        guard let lastCount else { return }
        set(lastCount)
    }

    private func set(_ value: Int) {
        #if canImport(UIKit)
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let authorization: BadgeAuthorization
            switch settings.authorizationStatus {
            case .denied:
                authorization = .denied
            case .notDetermined:
                authorization = .notDetermined
            default:
                // authorized, provisional and ephemeral all permit a badge.
                authorization = .allowed
            }

            let decision = Self.move(authorization: authorization, count: value)
            switch decision {
            case .skip:
                return
            case .proceed:
                Task { @MainActor in UNUserNotificationCenter.current().setBadgeCount(value) }
            }
        }
        #else
        NSApplication.shared.dockTile.badgeLabel = value == 0 ? nil : String(value)
        #endif
    }
}
