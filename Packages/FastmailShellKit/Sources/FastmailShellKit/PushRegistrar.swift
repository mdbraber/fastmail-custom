#if canImport(UIKit)
import UIKit
import UserNotifications

/// The phone's side of pushes: asks for permission, hands the device token to
/// the push server, and turns a tapped banner into a link for the shell.
@MainActor
public final class PushRegistrar: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// The one the app installed. With scenes, the delegate is not told about
    /// activation; AppShell is, through scenePhase, and reaches the registrar
    /// here.
    public private(set) static weak var current: PushRegistrar?

    private let config = PushConfig.from(bundle: .main)
    private let account = PushConfig.account(forBundleIdentifier: Bundle.main.bundleIdentifier)
    private var deviceToken: Data?
    private var registrationDue = false

    public override init() {
        super.init()
        Self.current = self
        // The old on/off switch becomes the first choice, before anything
        // reads the choice
        PushPreferences.migrate()
        NotificationCenter.default.addObserver(
            self, selector: #selector(defaultsChanged), name: UserDefaults.didChangeNotification, object: nil
        )
    }

    /// The notification's thread is not promised, so the work hops to the main
    /// actor. A new notification choice is not handled here: the page is the
    /// only thing that changes it, and it calls `choiceChanged()`.
    @objc private func defaultsChanged() {
        Task { @MainActor in
            // The badge label is one of these settings, and it names a shortcut
            HomeShortcuts.refresh()
        }
    }

    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        registerCategories()
        ask()
        HomeShortcuts.refresh()
        // A launch straight from the home screen menu, where there is no scene
        if let chosen = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            HomeShortcuts.open(chosen)
        }
        return true
    }

    /// SwiftUI runs in a scene, and a scene's quick action goes to the scene's
    /// delegate rather than to this one.
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

    /// One prompt for everything the shell wants, alerts, sound and badge,
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

    /// The buttons a banner carries. Registered at launch and not when one
    /// arrives: iOS matches the category the notification names against what
    /// the app has already declared, and draws no buttons at all for a name it
    /// does not know.
    private func registerCategories() {
        let message = UNNotificationCategory(
            identifier: PushAction.category,
            actions: PushAction.allCases.map {
                UNNotificationAction(identifier: $0.rawValue, title: $0.title, options: [])
            },
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([message])
    }

    /// Apple's device token, asked for only when there is a server to give it
    /// to and none has arrived yet.
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

    /// Apple's device token as the push server files it, for the page's push
    /// id line; nothing while the app has none.
    public var pushTokenHex: String? {
        deviceToken.map(PushConfig.hex)
    }

    /// Called once the Notifications page has saved a choice. A choice the
    /// server already has sends nothing, unless a registration is out: that
    /// one may carry a choice since taken back, which the saved choice now
    /// matches, so the repeat is what puts the server right.
    public func choiceChanged() {
        guard deviceToken != nil, inFlight != nil || PushPreferences.registrationDue() else { return }
        Task { await register() }
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
    /// trigger that arrives while one is out (the choice changed again, an
    /// activation) is folded into a repeat that reads the choice afresh, so
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
            // In the same job as the last look at `again`, so a trigger
            // cannot land between them and be dropped
            inFlight = nil
        }
        inFlight = task
        await task.value
    }

    /// A failure is remembered and tried again on the next activation, never shown.
    private func send() async {
        guard let config, let account, let deviceToken else { return }
        registrationDue = false
        let choice = PushPreferences.choice()
        do {
            let request = config.registration(account: account, deviceToken: deviceToken, choice: choice)
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            registrationDue = !(200..<300).contains(status)
            if registrationDue {
                print("[push] the push server answered \(status)")
            } else {
                // What was sent is what is acknowledged; the reply says
                // whether the server can read contacts, for the page's warning
                PushPreferences.acknowledge(choice, contacts: PushConfig.contacts(fromRegistrationReply: data))
            }
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
        let userInfo = response.notification.request.content.userInfo

        if let button = PushAction(rawValue: response.actionIdentifier) {
            let emailId = PushPayload.emailId(from: userInfo)
            Task { @MainActor in
                await PushRegistrar.current?.perform(button, on: emailId)
                completionHandler()
            }
            return
        }

        let url = PushPayload.url(from: userInfo)
        Task { @MainActor in
            if let url { PendingLinks.shared.open(url) }
            completionHandler()
        }
    }

    /// A button, done by the push server: this device has no Fastmail
    /// credentials and the few seconds a background action gets are enough for
    /// one request and not for a sign-in.
    private func perform(_ button: PushAction, on emailId: String?) async {
        guard let config, let account, let emailId else {
            return announce(button)
        }

        do {
            let (_, response) = try await URLSession.shared.data(
                for: config.action(button.rawValue, account: account, emailId: emailId)
            )
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if !(200..<300).contains(status) {
                print("[push] \(button.rawValue): the push server answered \(status)")
                announce(button)
            }
        } catch {
            print("[push] \(button.rawValue): the push server was unreachable: \(error.localizedDescription)")
            announce(button)
        }
    }

    /// Said as a notification of our own, since there is no app on screen to
    /// say it in.
    private func announce(_ failed: PushAction) {
        let content = UNMutableNotificationContent()
        content.title = failed.failureTitle
        content.body = failed.failureBody
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        )
    }
}
#endif
