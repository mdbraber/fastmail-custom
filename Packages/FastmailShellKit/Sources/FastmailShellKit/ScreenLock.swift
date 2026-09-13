#if canImport(UIKit)
import LocalAuthentication
import SwiftUI
import UIKit

/// The screen lock on iPhone and iPad: asks with Face ID, Touch ID or the
/// passcode, and keeps an opaque cover over the app while it is locked or not
/// in front. ScreenLockState decides when; this carries it out.
///
/// The cover is a window of its own above the app's, so it hides what the
/// app's window presents too: the in-app browser, a share sheet, a preview.
@MainActor
public final class ScreenLock: ObservableObject {
    public static let shared = ScreenLock()

    @Published public private(set) var state: ScreenLockState
    private var isInFront = false
    private let defaults: UserDefaults
    /// Held while an ask is out, so the context lives until it answers.
    private var context: LAContext?
    private var coverWindows: [UIWindow] = []

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        state = ScreenLockState(lockEnabled: DevicePreferences.screenLock(in: defaults))
    }

    public var isEnabled: Bool {
        DevicePreferences.screenLock(in: defaults)
    }

    /// Whether a link or page action handed in now waits for the lock to open.
    public var holdsLinks: Bool {
        state.wouldBeLocked(at: Date(), lockEnabled: isEnabled)
    }

    /// What this device unlocks with right now.
    public static func method() -> ScreenLockMethod {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { return .unavailable }
        // Hardware that is not enrolled still reports its type, and then the
        // passcode is what actually asks.
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return .passcode }
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return .passcode
        }
    }

    public func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            isInFront = true
            if state.becameActive(at: Date(), lockEnabled: isEnabled) { ask() }
        case .background:
            isInFront = false
            state.enteredBackground(at: Date())
        default:
            isInFront = false
        }
        updateCover()
    }

    public func unlockTapped() {
        if state.unlockTapped() { ask() }
        updateCover()
    }

    /// The page's switch. Turning it on asks once, and the switch stays on
    /// only if that succeeds; turning it off needs nothing, since the page is
    /// only reachable with the app open.
    public func setEnabled(_ on: Bool) {
        guard on else {
            defaults.set(false, forKey: DevicePreferences.screenLockKey)
            objectWillChange.send()
            return
        }
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            objectWillChange.send()
            return
        }
        self.context = context
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Turn on the screen lock") { [weak self] succeeded, _ in
            Task { @MainActor in
                guard let self else { return }
                self.context = nil
                if succeeded { self.defaults.set(true, forKey: DevicePreferences.screenLockKey) }
                self.objectWillChange.send()
            }
        }
    }

    private func ask() {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            // The passcode was removed after the lock was turned on, so
            // nothing can ask: the app opens and the switch goes off.
            state.cannotAsk()
            defaults.set(false, forKey: DevicePreferences.screenLockKey)
            objectWillChange.send()
            updateCover()
            return
        }
        self.context = context
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock your mail") { [weak self] succeeded, _ in
            Task { @MainActor in
                guard let self else { return }
                self.context = nil
                self.state.finishedAsking(succeeded: succeeded)
                self.updateCover()
            }
        }
    }

    private func updateCover() {
        guard state.coversContent(isInFront: isInFront, lockEnabled: isEnabled) else {
            for window in coverWindows { window.isHidden = true }
            coverWindows.removeAll()
            return
        }
        guard coverWindows.isEmpty else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.rootViewController = UIHostingController(rootView: LockCover(lock: self))
            window.isHidden = false
            coverWindows.append(window)
        }
    }
}

/// What is on screen while the lock is up: the app's name and a way to ask
/// again, and nothing of the mail behind it.
private struct LockCover: View {
    @ObservedObject var lock: ScreenLock

    private var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? ""
    }

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(.secondary)
                Text(appName)
                    .font(.title2.weight(.semibold))
                Button("Unlock") { lock.unlockTapped() }
                    .buttonStyle(.borderedProminent)
            }
        }
    }
}
#endif
