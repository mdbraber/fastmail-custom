import Foundation

/// Where a message opens when you ask for one.
///
/// Fastmail's own C key writes the message in the page you are looking at.
/// The Mac can do better than that when you want it: a tab beside the mailbox,
/// or a window of its own. Which one you get is a setting, and the other two
/// are always at hand — hold Option for the page, Command and Option for a
/// tab — so the setting picks a habit rather than shutting a door. The C key
/// and Fastmail's own Compose button both read the same way.
public enum ComposeMode: String, CaseIterable, Sendable {
    case inline
    case tab
    case window

    public static let defaultsKey = "composeMode"

    /// A window, unless the setting says otherwise: a message being written is
    /// a thing in its own right, and it is the mode that neither covers the
    /// mailbox nor waits behind a tab.
    public static let fallback: ComposeMode = .window

    public var title: String {
        switch self {
        case .inline: return "In the page"
        case .tab: return "In a tab"
        case .window: return "In a window"
        }
    }

    public var hint: String {
        switch self {
        case .inline: return "Fastmail's own compose, over the mailbox you are looking at."
        case .tab: return "A tab beside the mailbox, in the same window."
        case .window: return "A window of its own."
        }
    }

    /// What the setting says, from a dictionary of stored values. Anything
    /// unreadable is not an answer, and falls back like a missing one.
    public static func stored(in values: [String: Any]) -> ComposeMode {
        guard
            let raw = values[defaultsKey] as? String,
            let mode = ComposeMode(rawValue: raw)
        else { return fallback }
        return mode
    }

    public static func stored(in defaults: UserDefaults = .standard) -> ComposeMode {
        stored(in: [defaultsKey: defaults.string(forKey: defaultsKey) as Any])
    }

    /// What a press of the C key, or a click of the Compose button, is asking
    /// for. Plain follows the setting, so it asks for "default" and is told
    /// where the message went; the other two name the place themselves.
    /// Shift is Fastmail's own business, and Command on its own is Copy.
    public static func asked(alt: Bool, command: Bool, shift: Bool) -> String? {
        if shift { return nil }
        if alt { return command ? tab.rawValue : inline.rawValue }
        return command ? nil : "default"
    }

    /// The mode a page's request resolves to, given what the setting says.
    public static func resolve(asked: String, setting: ComposeMode) -> ComposeMode? {
        if asked == "default" { return setting }
        return ComposeMode(rawValue: asked)
    }
}

#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit

@MainActor
public enum ComposeCommands {
    /// Opens a message where the page asked for it, and says where it went.
    /// "inline" is not something the app can do — it is Fastmail's own
    /// compose — so it is handed back for the page to open itself.
    @discardableResult
    public static func open(asked: String, setting: ComposeMode = .stored()) -> String {
        guard let mode = ComposeMode.resolve(asked: asked, setting: setting) else {
            return ComposeMode.inline.rawValue
        }
        switch mode {
        case .inline:
            break
        case .window:
            ComposeWindows.shared.compose()
        case .tab:
            ComposeWindows.shared.compose(inTabOf: NSApp.keyWindow)
        }
        return mode.rawValue
    }
}
#endif
