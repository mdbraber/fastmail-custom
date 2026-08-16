import Foundation
import WebKit

/// The Inbox mode userscript's settings, mirrored natively.
///
/// One catalog drives everything: the macOS Settings form, the keys the iOS
/// Settings.bundle uses, and the object pushed into the page. Kept in step
/// with the userscript's DEFAULT_SETTINGS (and the Safari extension's
/// settings.js/settings.html, which carry the same options and copy).
///
/// The userscript reads `window.__customInboxModeSettings` once at startup
/// and merges it over its own defaults; a running copy accepts changes
/// through `window.customInboxMode.applySettings(...)`. Both entry points
/// are fed from here.
public enum InboxModeSettings {
    public struct Option: Identifiable, Sendable {
        public enum Value: Equatable, Sendable {
            case toggle(Bool)
            case text(String)
        }

        /// The bare key the userscript knows this setting by.
        public let key: String
        /// The toggle this one is a sub-option of, if any.
        public let parent: String?
        public let title: String
        public let hint: String
        public let defaultValue: Value

        public var id: String { key }

        /// Where the setting lives in UserDefaults. Prefixed so the shell's
        /// own keys (startView, …) and the page's cannot collide with it.
        public var defaultsKey: String { "inboxMode.\(key)" }

        init(_ key: String, parent: String? = nil, title: String, hint: String, default value: Value) {
            self.key = key
            self.parent = parent
            self.title = title
            self.hint = hint
            self.defaultValue = value
        }
    }

    public static let options: [Option] = [
        Option(
            "labelColours",
            title: "Colour rows by label",
            hint: "While Inbox mode is on, marks each message with the colour of a label it carries. Only labels you have given a colour show up.",
            default: .toggle(true)
        ),
        Option(
            "labelColoursSidebarOnly",
            parent: "labelColours",
            title: "Only labels that are inboxes",
            hint: "Only labels that a saved search names as an inbox get a colour. Everything else you file into stays uncoloured, so the list shows which inbox a message belongs to rather than every tag it carries.",
            default: .toggle(true)
        ),
        Option(
            "labelColoursSkipProcess",
            parent: "labelColours",
            title: "Ignore the Process marker",
            hint: "Everything you keep carries it, so colouring by it would tint the whole list one shade. Turn this off to see its colour like any other.",
            default: .toggle(true)
        ),
        Option(
            "sidebarSeparators",
            title: "Separate folders from labels",
            hint: "Draws a line in the sidebar wherever the system folders give way to your labels, or back again. A label kept inside the Inbox stays with it, without a line of its own.",
            default: .toggle(true)
        ),
        Option(
            "hideLoneExpando",
            title: "Hide the Labels collapse arrow",
            hint: "Fastmail puts an arrow on the Labels heading as soon as you have a second mail account, even when that account shows nothing in the sidebar — leaving it to collapse the only section there is. This hides it until another account’s sources actually appear.",
            default: .toggle(true)
        ),
        Option(
            "dragAdditive",
            title: "Dragging adds a label",
            hint: "Dropping a message on a label files it there and leaves it in the Inbox. Hold Option to move instead.",
            default: .toggle(true)
        ),
        Option(
            "hideInboxLabel",
            title: "Hide the Inbox chip",
            hint: "In a view where every row is in the Inbox — a label filtered to the Inbox, or on the Actionable or Triage filter — the chip says nothing, so it is left out.",
            default: .toggle(true)
        ),
        Option(
            "stripLabelPrefix",
            title: "Show only the label’s own name",
            hint: "A nested label reads “Work” rather than “Projects/Work”, both in the list and on an open message. Hovering still shows the full path.",
            default: .toggle(true)
        ),
        Option(
            "labelsShortcut",
            title: "V keeps a message",
            hint: "Adds the Process marker and takes off any deferred label, leaving the message in the Inbox. A message with no topic label yet first opens a picker narrowed to your sidebar, so it can be filed by typing. Shift-V opens the same narrowed menu just to change labels, and Option-V opens Move to as Fastmail ships it.",
            default: .toggle(true)
        ),
        Option(
            "labelsSidebarOnly",
            parent: "labelsShortcut",
            title: "Only labels that are inboxes",
            hint: "Leaves out Trash, Archive, Spam and any label no saved search names as an inbox, so a stray letter cannot land on one. Typing a name still finds any label of your own; Trash and the rest stay out either way.",
            default: .toggle(true)
        ),
        Option(
            "labelsAutoSave",
            parent: "labelsShortcut",
            title: "Auto-save the last label standing",
            hint: "Once typing has left one label, it is applied and the menu closes, with no Enter to press. Never applies to creating a new label.",
            default: .toggle(true)
        ),
        Option(
            "processLabel",
            title: "Label that marks kept mail",
            hint: "The verbs put this label on whatever you keep and strip it again on archive and snooze, so its badge counts what is still to work through. A marker, not a place — kept messages stay in the Inbox.",
            default: .text("Process")
        ),
        Option(
            "qualifierLabels",
            title: "Labels that qualify rather than place",
            hint: "Labels that cut across your inboxes — a message is urgent and somewhere. Their colour outranks the inbox’s on a message row, and when more than one applies the first named wins. Comma-separated, matched on the full path.",
            default: .text("Admin, Waiting")
        ),
        Option(
            "deferredLabels",
            title: "Labels that defer",
            hint: "What the actionable filter hides: a message on any of these drops out of the Inbox and every topic until it comes back. Filing into one also takes the Process marker off — deferring is a move, not a tag. Comma-separated, matched on the full path.",
            default: .text("Waiting, Snoozed")
        ),
        Option(
            "showFilteredCounts",
            title: "Show exact filtered counts",
            hint: "The heading of a filtered list and the badge on each topic label show their exact actionable count, asked of the server once and kept fresh from then on. Off, filtered headings show no number and topics carry no badge.",
            default: .toggle(false)
        ),
        Option(
            "swapArchiveExpand",
            title: "Swap E and Y",
            hint: "E archives and Y expands a thread, the other way round from Fastmail. H still archives.",
            default: .toggle(true)
        )
    ]

    /// The settings as the userscript should see them: stored value if one
    /// exists, the default otherwise. A text field left empty falls back to
    /// its default too — an empty label name means nothing to the userscript.
    public static func current(from defaults: UserDefaults = .standard) -> [String: Any] {
        var settings: [String: Any] = [:]
        for option in options {
            switch option.defaultValue {
            case .toggle(let fallback):
                settings[option.key] = defaults.object(forKey: option.defaultsKey) as? Bool ?? fallback
            case .text(let fallback):
                let stored = defaults.string(forKey: option.defaultsKey)?
                    .trimmingCharacters(in: .whitespaces)
                settings[option.key] = (stored?.isEmpty == false) ? stored! : fallback
            }
        }
        return settings
    }

    static func json(from defaults: UserDefaults) -> String {
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: current(from: defaults),
                options: [.sortedKeys]
            ),
            let json = String(data: data, encoding: .utf8)
        else { return "{}" }
        return json
    }

    /// Writes the settings global before anything else runs, so the payload
    /// finds it when it starts — the WKUserScript counterpart of the Safari
    /// extension injecting settings ahead of its payload.
    @MainActor
    public static func bootstrapScript(from defaults: UserDefaults = .standard) -> WKUserScript {
        WKUserScript(
            source: "window.__customInboxModeSettings = \(json(from: defaults));",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    }

    /// Pushes the settings into a page that is already running. The global is
    /// refreshed as well so a payload injected later still reads the latest.
    public static func applyScriptSource(from defaults: UserDefaults = .standard) -> String {
        """
        window.__customInboxModeSettings = \(json(from: defaults));
        if (window.customInboxMode) window.customInboxMode.applySettings(window.__customInboxModeSettings);
        """
    }
}
