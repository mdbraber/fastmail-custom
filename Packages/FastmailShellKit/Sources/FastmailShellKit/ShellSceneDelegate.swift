#if canImport(UIKit)
import UIKit

/// The scene's side of the home screen's long-press menu.
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
