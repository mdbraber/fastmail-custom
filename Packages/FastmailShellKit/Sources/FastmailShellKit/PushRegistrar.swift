#if canImport(UIKit)
import UIKit
import UserNotifications

/// The phone's side of pushes: asks for permission, hands the device token
/// to the push server, and turns a tapped banner into a link for the shell.
/// The server writes the words; this only registers and routes.
@MainActor
public final class PushRegistrar: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// The one the app installed. With scenes, the delegate is not told
    /// about activation; AppShell is, through scenePhase, and reaches the
    /// registrar here.
    public private(set) static weak var current: PushRegistrar?

    private let config = PushConfig.from(bundle: .main)
    private let account = PushConfig.account(forBundleIdentifier: Bundle.main.bundleIdentifier)
    private var deviceToken: Data?
    private var registrationDue = false

    public override init() {
        super.init()
        Self.current = self
    }

    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        ask()
        return true
    }

    /// One prompt for everything the shell wants — alerts, sound and badge —
    /// then the badge that waited on it, and Apple's token if pushes are in.
    private func ask() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            Task { @MainActor in
                BadgeController.shared.reapply()
                guard granted else { return }
                PushRegistrar.current?.requestToken()
            }
        }
    }

    /// Apple's device token, asked for only when there is a server to give
    /// it to and none has arrived yet. Asked again on every activation until
    /// it comes: a launch without network gets none, and Apple does not
    /// retry on the app's behalf.
    private func requestToken() {
        guard config != nil, account != nil, deviceToken == nil else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Called by AppShell when the scene becomes active.
    public func becameActive() {
        // Whatever was announced is on screen now
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        if deviceToken == nil {
            // Permission may have been granted in Settings since launch
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                let allowed = settings.authorizationStatus == .authorized
                    || settings.authorizationStatus == .provisional
                guard allowed else { return }
                Task { @MainActor in PushRegistrar.current?.requestToken() }
            }
        } else if registrationDue {
            Task { await register() }
        }
    }

    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        self.deviceToken = deviceToken
        Task { await register() }
    }

    public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        print("[push] Apple would not register this device: \(error.localizedDescription)")
    }

    /// Tells the server about this device. A failure is remembered and tried
    /// again on the next activation, never shown.
    private func register() async {
        guard let config, let account, let deviceToken else { return }
        registrationDue = false
        do {
            let (_, response) = try await URLSession.shared.data(for: config.registration(account: account, deviceToken: deviceToken))
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            registrationDue = !(200..<300).contains(status)
            if registrationDue { print("[push] the push server answered \(status)") }
        } catch {
            registrationDue = true
            print("[push] the push server was unreachable: \(error.localizedDescription)")
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    /// Only consulted while the app is in front, where the page is on
    /// screen: the badge applies, the banner and sound do not.
    nonisolated public static let foregroundPresentation: UNNotificationPresentationOptions = [.badge]

    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler(Self.foregroundPresentation)
    }

    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let url = PushPayload.url(from: response.notification.request.content.userInfo)
        Task { @MainActor in
            if let url { PendingLinks.shared.open(url) }
            completionHandler()
        }
    }
}
#endif
