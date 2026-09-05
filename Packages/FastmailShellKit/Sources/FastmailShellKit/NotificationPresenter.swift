#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import UserNotifications

/// Shows the notifications Fastmail's own page hands over, and routes a
/// click back to it. Fastmail decides what to notify and writes the words;
/// this only presents them, the way its desktop app would.
@MainActor
public final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    public static let shared = NotificationPresenter()

    /// Given the notification's own click payload, verbatim, so the page can
    /// hand it to the service worker that wrote it.
    public var onClick: @MainActor (String) -> Void = { _ in }

    private var authorizationRequested = false
    private var authorizationDenied = false
    private var waiting: [MailNotification] = []

    private override init() {
        super.init()
    }

    public func install() {
        UNUserNotificationCenter.current().delegate = self
    }

    // While the app is frontmost the page is on screen and the message
    // arrives in it; a banner on top would say what you are looking at.
    nonisolated public static func shouldPresent(appActive: Bool) -> Bool {
        !appActive
    }

    public func show(_ notification: MailNotification) {
        if authorizationDenied { return }
        guard authorizationRequested else {
            authorizationRequested = true
            waiting.append(notification)
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) {
                [weak self] granted, _ in
                Task { @MainActor in
                    guard let self else { return }
                    let queued = self.waiting
                    self.waiting = []
                    if granted {
                        queued.forEach(self.deliver)
                    } else {
                        self.authorizationDenied = true
                    }
                }
            }
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
        NSApp.activate(ignoringOtherApps: true)
        (NSApp.keyWindow ?? NSApp.windows.first { $0.isVisible })?.makeKeyAndOrderFront(nil)
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
