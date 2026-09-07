#if canImport(UIKit)
import UIKit
import UserNotifications

/// The phone's side of pushes: asks for permission, hands the device token
/// to the push server, and turns a tapped banner into a link for the shell.
/// The server writes the words; this only registers and routes. As the app's
/// one delegate it also keeps the home screen's long-press menu in step with
/// the settings, and turns a chosen entry into the same kind of link.
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
        // The alerts switch, flipped in the sheet or in the Settings app,
        // reaches the server through a fresh registration
        NotificationCenter.default.addObserver(
            self, selector: #selector(defaultsChanged), name: UserDefaults.didChangeNotification, object: nil
        )
    }

    /// The notification's thread is not promised, so the work hops to the
    /// main actor. The acknowledgement written after a registration lands
    /// here too; by then the switch and the acknowledged value agree, so
    /// nothing is due and the chain ends.
    @objc private func defaultsChanged() {
        Task { @MainActor in
            // The badge label is one of these settings, and it names a shortcut
            HomeShortcuts.refresh()
            guard let registrar = PushRegistrar.current, registrar.deviceToken != nil, PushPreferences.registrationDue() else { return }
            await registrar.register()
        }
    }

    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        ask()
        HomeShortcuts.refresh()
        // A launch straight from the home screen menu, where there is no scene
        if let chosen = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            HomeShortcuts.open(chosen)
        }
        return true
    }

    /// SwiftUI runs in a scene, and a scene's quick action goes to the scene's
    /// delegate rather than to this one. Naming a delegate class here is how a
    /// SwiftUI app is given one; the rest of the configuration is left as the
    /// session already has it, so SwiftUI's own window setup is untouched.
    public func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(
            name: connectingSceneSession.configuration.name,
            sessionRole: connectingSceneSession.role
        )
        configuration.delegateClass = ShellSceneDelegate.self
        return configuration
    }

    /// Chosen while the app was already running, on a build with no scene.
    public func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(HomeShortcuts.open(shortcutItem))
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
        } else if registrationDue || PushPreferences.registrationDue() {
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

    private var inFlight: Task<Void, Never>?
    private var again = false

    /// Tells the server about this device. One registration at a time: a
    /// trigger that arrives while one is out (the switch flipped again, an
    /// activation) is folded into a repeat that reads the switch afresh, so
    /// the last word the server hears is the current one.
    private func register() async {
        if inFlight != nil {
            again = true
            return
        }
        let task = Task { @MainActor in
            repeat {
                again = false
                await send()
            } while again
        }
        inFlight = task
        await task.value
        inFlight = nil
    }

    /// A failure is remembered and tried again on the next activation, never shown.
    private func send() async {
        guard let config, let account, let deviceToken else { return }
        registrationDue = false
        let alerts = PushPreferences.alertsEnabled()
        do {
            let request = config.registration(account: account, deviceToken: deviceToken, alerts: alerts)
            let (_, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            registrationDue = !(200..<300).contains(status)
            if registrationDue { print("[push] the push server answered \(status)") } else { PushPreferences.acknowledge(alerts: alerts) }
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
