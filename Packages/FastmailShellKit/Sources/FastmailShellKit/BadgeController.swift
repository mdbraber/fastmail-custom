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

public enum BadgeAuthorizationMove: Equatable, Sendable {
    case proceed
    case request
    case skip
}

@MainActor
public final class BadgeController {
    public static let shared = BadgeController()

    private var authorizationRequested = false
    private var authorizationDenied = false

    init() {}

    nonisolated public static func action(for count: Int?) -> BadgeAction {
        guard let count, count >= 0 else { return .leave }
        return count == 0 ? .clear : .show(count)
    }

    nonisolated public static func authorizationMove(
        requested: Bool, denied: Bool, count: Int
    ) -> BadgeAuthorizationMove {
        if denied { return .skip }
        if count > 0 && !requested { return .request }
        return .proceed
    }

    public func apply(_ count: Int?) {
        switch Self.action(for: count) {
        case .leave:
            return
        case .clear:
            set(0)
        case .show(let value):
            set(value)
        }
    }

    private func set(_ value: Int) {
        #if canImport(UIKit)
        switch Self.authorizationMove(
            requested: authorizationRequested, denied: authorizationDenied, count: value
        ) {
        case .skip:
            return
        case .request:
            authorizationRequested = true
            UNUserNotificationCenter.current().requestAuthorization(options: [.badge]) {
                [weak self] granted, _ in
                Task { @MainActor in
                    guard let self else { return }
                    if granted {
                        self.set(value)
                    } else {
                        self.authorizationDenied = true
                    }
                }
            }
        case .proceed:
            UNUserNotificationCenter.current().setBadgeCount(value)
        }
        #else
        NSApplication.shared.dockTile.badgeLabel = value == 0 ? nil : String(value)
        #endif
    }
}
