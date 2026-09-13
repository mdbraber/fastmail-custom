#if canImport(UIKit)
import UIKit
import UserNotifications

/// The app's half of the Notifications page: what the page is shown, where a
/// choice is kept, and the way to the app's page in iOS Settings.
@MainActor
enum NotificationSettings {
    /// Read fresh each time: the page asks again whenever the window comes
    /// back, so a permission granted in iOS Settings shows at once.
    static func state() async -> NotificationState {
        let status: UNAuthorizationStatus = await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus)
            }
        }
        return NotificationState(
            choice: PushPreferences.choice(),
            permission: NotificationState.Permission(status: status),
            pushToken: PushRegistrar.current?.pushTokenHex,
            contacts: PushPreferences.contacts()
        )
    }

    /// Saved first, then registered through the registrar's single-flight
    /// registration; a failed registration is tried again on the next
    /// activation.
    static func save(_ choice: NotificationChoice) -> NotificationChoice {
        PushPreferences.save(choice)
        PushRegistrar.current?.choiceChanged()
        return PushPreferences.choice()
    }

    /// The app's notification page in iOS Settings; the app's own page there
    /// if that address cannot be made.
    static func openSystemSettings() {
        guard let url = URL(string: UIApplication.openNotificationSettingsURLString)
            ?? URL(string: UIApplication.openSettingsURLString)
        else { return }
        UIApplication.shared.open(url)
    }
}
#endif
