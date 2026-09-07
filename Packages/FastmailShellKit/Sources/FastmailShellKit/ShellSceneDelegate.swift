#if canImport(UIKit)
import UIKit

/// The scene's side of the home screen's long-press menu. SwiftUI builds the
/// window; this only listens for the entry the long press chose — on a cold
/// launch it arrives with the scene's connection options, and later through
/// the scene itself. Either way it becomes a pending link, which the shell
/// loads as soon as it is on screen.
public final class ShellSceneDelegate: NSObject, UIWindowSceneDelegate {
    public func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let chosen = connectionOptions.shortcutItem else { return }
        Task { @MainActor in HomeShortcuts.open(chosen) }
    }

    public func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        Task { @MainActor in completionHandler(HomeShortcuts.open(shortcutItem)) }
    }
}
#endif
