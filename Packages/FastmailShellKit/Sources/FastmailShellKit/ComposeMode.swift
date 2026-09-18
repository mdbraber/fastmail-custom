import Foundation

/// Where a message opens when you ask for one. Fastmail's own C key writes the
/// message in the page you are looking at.
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

    /// Whether opening a draft to carry on writing it goes the same way as a
    /// new message.
    public static let editDraftDefaultsKey = "editDraftFollowsCompose"

    /// Off unless it has been asked for. Fastmail has its own mind about a
    /// draft, in the page or in a window of its own depending on how you
    /// opened it, and a setting nobody has touched should leave that alone.
    public static let editDraftFallback = false

    public static func editDraftFollowsCompose(in values: [String: Any]) -> Bool {
        values[editDraftDefaultsKey] as? Bool ?? editDraftFallback
    }

    public static func editDraftFollowsCompose(in defaults: UserDefaults = .standard) -> Bool {
        guard defaults.object(forKey: editDraftDefaultsKey) != nil else { return editDraftFallback }
        return defaults.bool(forKey: editDraftDefaultsKey)
    }

    /// The answer Fastmail gets when the app did not take a draft off its
    /// hands, and it should open the draft as it always has.
    public static let leaveItToFastmail = "fastmail"

    /// What the page should do with a draft it was about to open, given the
    /// setting. `nil` leaves it to Fastmail, which is the answer whenever
    /// the setting is off.
    public static func editDraft(follows: Bool, setting: ComposeMode) -> ComposeMode? {
        follows ? setting : nil
    }

    /// What a press of the C key, or a click of the Compose button, is asking
    /// for.
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

    /// Opens a draft that already exists where the compose setting says, and
    /// says where it went.
    @discardableResult
    public static func editDraft(
        id: String,
        setting: ComposeMode = .stored(),
        follows: Bool = ComposeMode.editDraftFollowsCompose()
    ) -> String {
        guard let mode = ComposeMode.editDraft(follows: follows, setting: setting) else {
            return ComposeMode.leaveItToFastmail
        }
        switch mode {
        case .inline:
            break
        case .window, .tab:
            guard ComposeWindows.shared.compose(draft: id, mode: mode) else {
                return ComposeMode.leaveItToFastmail
            }
        }
        return mode.rawValue
    }
}
#endif
