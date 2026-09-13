import Foundation
import UserNotifications

/// Everything the Notifications page draws from, as the `notificationState`
/// bridge action answers it.
public struct NotificationState: Equatable, Sendable {
    public enum Permission: String, Sendable {
        case allowed, denied, undetermined

        /// Provisional and ephemeral delivery still reach the device, so they
        /// count as allowed.
        public init(status: UNAuthorizationStatus) {
            switch status {
            case .denied: self = .denied
            case .notDetermined: self = .undetermined
            default: self = .allowed
            }
        }
    }

    public let choice: NotificationChoice
    public let permission: Permission
    /// Apple's device token in lowercase hex, or nothing while the app has none.
    public let pushToken: String?
    /// Whether the push server can read the account's contacts, or nothing
    /// while no registration reply has said.
    public let contacts: Bool?

    public init(choice: NotificationChoice, permission: Permission, pushToken: String?, contacts: Bool?) {
        self.choice = choice
        self.permission = permission
        self.pushToken = pushToken
        self.contacts = contacts
    }

    public var jsonObject: [String: Any] {
        var object = choice.jsonObject
        object["permission"] = permission.rawValue
        object["pushToken"] = pushToken.map { $0 as Any } ?? NSNull()
        object["contacts"] = contacts.map { $0 as Any } ?? NSNull()
        return object
    }

    public var json: String { NotificationChoice.jsonText(jsonObject) }
}
