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
        /// Whether an empty text field is an answer rather than an omission.
        ///
        /// For most text settings it is an omission: a kept marker with no
        /// name, or a waiting label called nothing, is not something anyone
        /// means, so emptying the field asks for the default back. But a
        /// list of labels has a meaningful empty — none of them — and
        /// without this there was no way to say it: clearing "Labels that
        /// are never topics" put Later straight back, which is what sent me
        /// looking. Two hints already promised this behaviour ("Empty for
        /// the app's own default", "or empty for the plain total") and could
        /// not deliver it.
        public let clearable: Bool
        public let title: String
        public let hint: String
        public let defaultValue: Value

        public var id: String { key }

        /// Where the setting lives in UserDefaults. Prefixed so the shell's
        /// own keys (startView, …) and the page's cannot collide with it.
        public var defaultsKey: String { "inboxMode.\(key)" }

        init(
            _ key: String,
            parent: String? = nil,
            clearable: Bool = false,
            title: String,
            hint: String,
            default value: Value
        ) {
            self.key = key
            self.parent = parent
            self.clearable = clearable
            self.title = title
            self.hint = hint
            self.defaultValue = value
        }
    }

    public static let options: [Option] = [
        Option(
            "labelColours",
            title: "Colour rows by label",
            hint: "Rows take the colour of a label they carry.",
            default: .toggle(true)
        ),
        Option(
            "labelColoursSidebarOnly",
            parent: "labelColours",
            title: "Only labels that are inboxes",
            hint: "Plain filing tags stay unpainted.",
            default: .toggle(true)
        ),
        Option(
            "labelColoursSkipProcess",
            parent: "labelColours",
            title: "Ignore the kept marker",
            hint: "Everything kept carries it; its colour would tint the whole list.",
            default: .toggle(true)
        ),
        Option(
            "sidebarSeparators",
            title: "Separate folders from labels",
            hint: "A line where the system folders end and your labels begin.",
            default: .toggle(true)
        ),
        Option(
            "hideLoneExpando",
            title: "Hide the Labels collapse arrow",
            hint: "Until a second account actually shows sidebar sources.",
            default: .toggle(true)
        ),
        Option(
            "dragAdditive",
            title: "Dragging adds a label",
            hint: "A drop files the message and leaves it in the Inbox; Option moves.",
            default: .toggle(true)
        ),
        Option(
            "hideInboxLabel",
            title: "Hide the Inbox chip",
            hint: "Wherever every row is in the Inbox anyway.",
            default: .toggle(true)
        ),
        Option(
            "stripLabelPrefix",
            title: "Show only the label’s own name",
            hint: "“Work”, not “Projects/Work”; hover for the full path.",
            default: .toggle(true)
        ),
        Option(
            "labelsShortcut",
            title: "V keeps a message",
            hint: "Adds the kept marker, clears deferrals; unfiled mail gets the picker first. Shift-V labels only, Option-V is stock Move to.",
            default: .toggle(true)
        ),
        Option(
            "labelsSidebarOnly",
            parent: "labelsShortcut",
            title: "Only labels that are inboxes",
            hint: "The picker hides Trash, Spam and plain tags; typing still finds any label.",
            default: .toggle(true)
        ),
        Option(
            "labelsAutoSave",
            parent: "labelsShortcut",
            title: "Auto-save the last label standing",
            hint: "One match left applies itself and closes the menu.",
            default: .toggle(true)
        ),
        Option(
            "processLabel",
            title: "The kept marker",
            hint: "On everything kept; stripped again on archive and snooze.",
            default: .text("Next")
        ),
        Option(
            "qualifierLabels",
            clearable: true,
            title: "Qualifier labels",
            hint: "Cut across topics and never count as filing; first named wins the row colour. Comma-separated paths.",
            default: .text("Admin, Waiting")
        ),
        Option(
            "deferredLabels",
            clearable: true,
            title: "Deferred labels",
            hint: "Hidden from Next; filing into one drops the kept marker. Comma-separated paths.",
            default: .text("Waiting, Snoozed")
        ),
        Option(
            "waitingLabel",
            title: "The waiting label",
            hint: "Where w parks mail blocked on someone else.",
            default: .text("Waiting")
        ),
        Option(
            "somedayLabel",
            title: "The someday label",
            hint: "Where o parks mail with no commitment attached.",
            default: .text("Someday")
        ),
        Option(
            "nonInboxLabels",
            clearable: true,
            title: "Non-inbox labels",
            hint: "Worked from the label, not the Inbox: v into one marks it Next and takes the Inbox off, where a topic leaves the Inbox on. A topic on the thread outranks it. Comma-separated paths.",
            default: .text("")
        ),
        Option(
            "excludedLabels",
            clearable: true,
            title: "Labels that are never topics",
            hint: "Never offered as topics; alone they don’t count as filed. Comma-separated paths.",
            default: .text("Later")
        ),
        Option(
            "contactGroupLabels",
            clearable: true,
            title: "Labels that add the sender contacts group",
            hint: "Picking one in the topic picker also files the sender into the contact group of the same name, creating the contact if it is new. Comma-separated paths.",
            default: .text("")
        ),
        Option(
            "urgentKey",
            title: "Urgent key",
            hint: "Runs keep + pin.",
            default: .text("s")
        ),
        Option(
            "waitingKey",
            title: "Waiting key",
            hint: "Parks on the waiting label.",
            default: .text("w")
        ),
        Option(
            "somedayKey",
            title: "Someday key",
            hint: "Parks on the someday label. Claims Fastmail’s open key; Enter still opens.",
            default: .text("o")
        ),
        Option(
            "bottomBarSlots",
            title: "Bottom bar verbs",
            hint: "Drag to order the phone bar’s verbs; what fits on screen shows, the rest wait in More.",
            default: .text("Snooze, Pin, Archive, Labels, Keep, Waiting, Someday, Delete, Move")
        ),
        Option(
            "showFilteredCounts",
            title: "Show exact filtered counts",
            hint: "Sidebar badges show the server-exact count of each label’s own filter, with unread in parens.",
            default: .toggle(true)
        ),
        Option(
            "showHeaderCounts",
            title: "Counts in list headings",
            hint: "The heading carries the same pair as the sidebar badge — total, unread in parens — including in the apps.",
            default: .toggle(true)
        ),
        Option(
            "appBadgeLabel",
            clearable: true,
            title: "App badge label",
            hint: "The app icon’s badge counts this label. Empty for the app’s own default.",
            default: .text("Inbox")
        ),
        Option(
            "appBadgeFilter",
            clearable: true,
            title: "App badge filter",
            hint: "next, triage, deferred, noninbox — or empty for the plain total.",
            default: .text("next")
        ),
        Option(
            "swapArchiveExpand",
            title: "Swap E and Y",
            hint: "E archives and Y expands, the other way round from Fastmail. H still archives.",
            default: .toggle(true)
        )
    ]

    /// The settings as the userscript should see them: stored value if one
    /// exists, the default otherwise.
    ///
    /// An empty text field means one of two things, and which one depends on
    /// the setting rather than on the value. For most it is an omission and
    /// the default comes back. For a `clearable` one it is an answer — none
    /// of them — and it is passed through as the empty string, which the
    /// userscript's own merge then lays over its default.
    ///
    /// Never set and set-to-empty are told apart by the presence of the key,
    /// not by the value, so a field nobody has touched still gets the
    /// default even where empty would have been honoured.
    public static func current(from defaults: UserDefaults = .standard) -> [String: Any] {
        var settings: [String: Any] = [:]
        for option in options {
            switch option.defaultValue {
            case .toggle(let fallback):
                settings[option.key] = defaults.object(forKey: option.defaultsKey) as? Bool ?? fallback
            case .text(let fallback):
                guard let stored = defaults.string(forKey: option.defaultsKey) else {
                    settings[option.key] = fallback
                    continue
                }

                let trimmed = stored.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty {
                    settings[option.key] = trimmed
                } else {
                    settings[option.key] = option.clearable ? "" : fallback
                }
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
