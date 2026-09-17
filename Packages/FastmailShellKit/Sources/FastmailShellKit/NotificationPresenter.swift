#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import UserNotifications

/// Shows the notifications Fastmail's own page hands over, and routes a click
/// back to it.
@MainActor
public final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    public static let shared = NotificationPresenter()

    /// Given the notification's own click payload, verbatim, so the page can
    /// hand it to the service worker that wrote it.
    public var onClick: @MainActor (String) -> Void = { _ in }

    private var authorizationGranted = false
    private var authorizationPending = false
    private var authorizationDenied = false
    private var waiting: [MailNotification] = []
    private var recent = RecentNotificationIds()

    private override init() {
        super.init()
    }

    public func install() {
        UNUserNotificationCenter.current().delegate = self
        // Asked at launch rather than when the first message arrives, so the
        // app is registered with the system and can be set up under
        // Notifications in System Settings before it has anything to show.
        ask()
    }

    /// One request at a time, and everything that arrived while it was out
    /// goes as soon as it is answered.
    private func ask() {
        guard !authorizationGranted, !authorizationDenied, !authorizationPending else { return }
        authorizationPending = true
        // .badge belongs here too: it is not only what lets a notification
        // carry a number, it is what registers this app with the system as
        // one whose dock badge counts at all. Leave it out and the same
        // dockTile.badgeLabel call BadgeController already makes sits there
        // unauthorized and silently unshown, no matter its value.
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) {
            [weak self] granted, error in
            Task { @MainActor in
                guard let self else { return }
                self.authorizationPending = false
                let queued = self.waiting
                self.waiting = []
                if granted {
                    self.authorizationGranted = true
                    queued.forEach(self.deliver)
                } else {
                    self.authorizationDenied = true
                    if let error { print("[notifications] \(error.localizedDescription)") }
                }
            }
        }
    }

    // While the app is frontmost the page is on screen and the message
    // arrives in it; a banner on top would say what you are looking at.
    nonisolated public static func shouldPresent(appActive: Bool) -> Bool {
        !appActive
    }

    public func show(_ notification: MailNotification) {
        if authorizationDenied { return }
        if recent.isRepeat(notification.id) { return }
        guard authorizationGranted else {
            // Every notification that arrives while authorization is still
            // undetermined waits here, not just the one that triggered the
            // request; otherwise a second or third notification in the same
            // burst falls through to deliver() before the prompt resolves.
            waiting.append(notification)
            ask()
            return
        }
        deliver(notification)
    }

    private func deliver(_ notification: MailNotification) {
        let content = UNMutableNotificationContent()
        content.title = notification.title
        content.body = notification.body
        if notification.sound { content.sound = .default }
        if let threadId = notification.threadId { content.threadIdentifier = threadId }
        content.userInfo = ["data": notification.dataJSON]
        if let image = notification.image, let file = NotificationImageFile.write(image) {
            // Taken on, the file is moved into the notification's own store
            if let attachment = try? UNNotificationAttachment(identifier: "sender", url: file, options: nil) {
                content.attachments = [attachment]
            } else {
                try? FileManager.default.removeItem(at: file)
            }
        }

        let request = UNNotificationRequest(identifier: notification.id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error { print("[notifications] \(error.localizedDescription)") }
        }
    }

    public func dismiss(ids: [String]) {
        guard !ids.isEmpty else { return }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
    }

    public func showWindow() {
        NSApp.activate()
        (NSApp.keyWindow ?? NSApp.windows.first { $0.isVisible })?.makeKeyAndOrderFront(nil)
    }

    /// The page's own idea of window.Notification.permission: read fresh
    /// each time, since a change in System Settings should show up without
    /// a relaunch.
    public func permissionStatus() async -> String {
        let status = await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus)
            }
        }
        return Self.permissionString(for: status)
    }

    /// What the page's own "Enable notifications" button calls, standing in
    /// for window.Notification.requestPermission(): the system only ever
    /// prompts once per install, so after the first ask this just answers
    /// with whatever was already decided.
    public func requestPermission() async -> String {
        let granted = await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) {
                granted, _ in continuation.resume(returning: granted)
            }
        }
        authorizationPending = false
        if granted {
            authorizationGranted = true
            let queued = waiting
            waiting = []
            queued.forEach(deliver)
        } else {
            authorizationDenied = true
        }
        return granted ? "granted" : "denied"
    }

    private static func permissionString(for status: UNAuthorizationStatus) -> String {
        switch status {
        case .denied: return "denied"
        case .notDetermined: return "default"
        default: return "granted"
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        Task { @MainActor in
            let active = NSApp.isActive
            completionHandler(Self.shouldPresent(appActive: active) ? [.banner, .sound] : [])
        }
    }

    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let data = response.notification.request.content.userInfo["data"] as? String ?? "{}"
        Task { @MainActor in
            self.showWindow()
            self.onClick(data)
            completionHandler()
        }
    }
}
#endif
